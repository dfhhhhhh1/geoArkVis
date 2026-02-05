const express = require("express");
const cors = require("cors");
const csv = require("csv-parser");
const fs = require("fs");
const { spawn } = require("child_process");
const path = require("path");

console.log("Starting semantic search server...");

const app = express();
app.use(cors());
app.use(express.json());

// In-memory storage for variables and embeddings
let variables = [];
let embeddings = [];
let isEmbeddingsReady = false;

// Helper function to normalize and combine text fields for embedding
function createEmbeddingText(row) {
  const parts = [];
  
  if (row.attr_label) parts.push(row.attr_label.trim());
  if (row.attr_desc) parts.push(row.attr_desc.trim());
  
  // Parse tags - handle both array format and string format
  if (row.tags) {
    try {
      // Remove brackets and quotes, split by comma
      const cleanTags = row.tags
        .replace(/[\[\]'\"]/g, '')
        .split(',')
        .map(tag => tag.trim())
        .filter(tag => tag.length > 0);
      parts.push(...cleanTags);
    } catch (e) {
      // If parsing fails, just add the raw string
      parts.push(row.tags.trim());
    }
  }
  
  return parts.join(' ').toLowerCase();
}

// Load CSV and prepare data
async function loadVariablesFromCSV(csvFilePath) {
  return new Promise((resolve, reject) => {
    const results = [];
    
    fs.createReadStream(csvFilePath)
      .pipe(csv())
      .on('data', (row) => {
        // Create embedding text from multiple fields
        const embeddingText = createEmbeddingText(row);
        
        // Store both original row and embedding text
        results.push({
          dataset_id: row.dataset_id || '',
          attr_id: row.attr_id || row.attr_label || '',
          attr_label: row.attr_label || '',
          attr_desc: row.attr_desc || '',
          tags: row.tags || '',
          entity_type: row.entity_type || '',
          start_date: row.start_date || '',
          end_date: row.end_date || '',
          embeddingText: embeddingText
        });
      })
      .on('end', () => {
        console.log(`Loaded ${results.length} variables from CSV`);
        resolve(results);
      })
      .on('error', reject);
  });
}

// Python script for generating embeddings
const pythonEmbeddingScript = `
import sys
import json
import re
import nltk
from nltk.stem import WordNetLemmatizer
from sentence_transformers import SentenceTransformer

# Download necessary NLP data
try:
    nltk.data.find('corpora/wordnet')
except LookupError:
    nltk.download('wordnet')
    nltk.download('omw-1.4')

lemmatizer = WordNetLemmatizer()

def clean_and_lemmatize(text):
    # 1. Remove special characters (|, ", (, ), etc.)
    text = re.sub(r'[\\|\\"\\(\\)\\[\\]\\{\\}\\/\\,]', ' ', text)
    # 2. Lowercase and split
    words = text.lower().split()
    # 3. Lemmatize (matches 'running' to 'run', 'cities' to 'city')
    lemmatized = [lemmatizer.lemmatize(w) for w in words]
    return " ".join(lemmatized)

def main():
    model = SentenceTransformer('BAAI/bge-base-en-v1.5')
    input_data = json.loads(sys.stdin.read())
    texts = input_data['texts']
    
    # Process all texts for lemmatization
    processed_texts = [clean_and_lemmatize(t) for t in texts]
    
    # Generate embeddings on the processed text
    embeddings = model.encode(processed_texts)
    
    result = {
        'embeddings': embeddings.tolist(),
        'processed_texts': processed_texts, # Return cleaned text for keyword matching
        'dimension': len(embeddings[0]) if len(embeddings) > 0 else 0
    }
    print(json.dumps(result))

if __name__ == '__main__':
    main()
`;

// Generate embeddings using Python subprocess
async function generateEmbeddings(texts) {
  return new Promise((resolve, reject) => {
    // Create temporary Python script
    const scriptPath = path.join(__dirname, 'temp_embedding_script.py');
    fs.writeFileSync(scriptPath, pythonEmbeddingScript);
    
    const python = spawn('python3', [scriptPath]);
    let output = '';
    let errorOutput = '';
    
    python.stdin.on('error', (err) => {
      console.error('Python stdin error:', err.message);
    });

    // Send input data
    try {
      python.stdin.write(JSON.stringify({ texts: texts }));
      python.stdin.end();
    } catch (e) {
        reject(new Error(`Failed to write to Python: ${e.message}`));
    }
    
    python.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    python.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });
    
    python.on('close', (code) => {
      // Clean up temp file
      try {
        fs.unlinkSync(scriptPath);
      } catch (e) {
        // Ignore cleanup errors
      }
      
      if (code !== 0) {
        reject(new Error(`Python script failed: ${errorOutput}`));
        return;
      }
      
      try {
        const result = JSON.parse(output);
        resolve(result);
      } catch (e) {
        reject(new Error(`Failed to parse embedding result: ${e.message}`));
      }
    });
    
    python.on('error', (err) => {
      reject(new Error(`Failed to spawn Python process: ${err.message}`));
    });
  });
}

// Cosine similarity function
function cosineSimilarity(vecA, vecB) {
  if (vecA.length !== vecB.length) {
    throw new Error('Vectors must be the same length');
  }
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  
  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);
  
  if (normA === 0 || normB === 0) {
    return 0;
  }
  
  return dotProduct / (normA * normB);
}

let processedVariablesText = [];

// Initialize embeddings at startup
async function initializeEmbeddings() {
  try {
    console.log("Loading variables from CSV...");
    
    // Try to load from the uploaded file first, fallback to a default name
    const csvPath = 'geoark_attributes.csv'; // Update this path as needed
    
    if (!fs.existsSync(csvPath)) {
      throw new Error(`CSV file not found at ${csvPath}. Please ensure the file exists.`);
    }
    
    variables = await loadVariablesFromCSV(csvPath);
    
    if (variables.length === 0) {
      throw new Error("No variables loaded from CSV");
    }
    
    console.log("Generating embeddings...");
    console.log("Generating embeddings in batches...");
    const texts = variables.map(v => v.embeddingText);
    const BATCH_SIZE = 500;
    embeddings = [];
    processedVariablesText = [];

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const batch = texts.slice(i, i + BATCH_SIZE);
        console.log(`Processing batch ${Math.floor(i/BATCH_SIZE) + 1}...`);
        
        const result = await generateEmbeddings(batch);
        embeddings.push(...result.embeddings);
        processedVariablesText.push(...result.processed_texts);
    }

    console.log(`Successfully generated ${embeddings.length} total embeddings.`);
    isEmbeddingsReady = true;
    console.log("Semantic search system ready!");
    
  } catch (error) {
    console.error("Failed to initialize embeddings:", error.message);
    console.error("Make sure you have:");
    console.error("1. Python installed with sentence-transformers library");
    console.error("2. CSV file in the correct location");
    console.error("3. Sufficient memory for embedding generation");
    process.exit(1);
  }
}

function getKeywordScore(queryProcessed, documentProcessed) {
  const queryWords = new Set(queryProcessed.split(/\s+/));
  const docWords = new Set(documentProcessed.split(/\s+/));
  
  let matches = 0;
  queryWords.forEach(word => {
    if (docWords.has(word)) matches++;
  });
  
  // Return a ratio: percentage of query words found in the document
  return queryWords.size > 0 ? matches / queryWords.size : 0;
}

// Search endpoint
app.get("/api/search", async (req, res) => {
  try {
    if (!isEmbeddingsReady) {
      return res.status(503).json({ 
        error: "Embeddings not ready yet. Please wait for system initialization." 
      });
    }
    
    const query = req.query.q;
    if (!query || query.trim().length === 0) {
      return res.json([]);
    }
    
    console.log(`Hybrid Searching for: "${query}"`);
    
    const bgeQuery = `Represent this sentence for searching relevant passages: ${query.toLowerCase()}`;

    // Generate embedding for query
    const queryResult = await generateEmbeddings([bgeQuery])
    const queryEmbedding = queryResult.embeddings[0];
    const queryCleaned = query.toLowerCase().trim();

    // Calculate similarities
    const results = embeddings.map((emb, i) => {
      const semanticScore = cosineSimilarity(queryEmbedding, emb);
      const keywordScore = getKeywordScore(queryCleaned, processedVariablesText[i]);
      
      // Combine scores: 70% Semantic weight, 30% Keyword weight
      const hybridScore = (semanticScore * 0.7) + (keywordScore * 0.3);

      return {
        variable: variables[i],
        score: hybridScore,
        details: { semanticScore, keywordScore }
      };
    });
    
    const topResults = results
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map(item => ({
        dataset_id: item.variable.dataset_id,
        attr_id: item.variable.attr_id,
        attr_label: item.variable.attr_label,
        attr_desc: item.variable.attr_desc,
        tags: item.variable.tags,
        entity_type: item.variable.entity_type,
        start_date: item.variable.start_date,
        end_date: item.variable.end_date,
        score: Math.round(item.score * 1000) / 1000, 
        match_type: item.details.keywordScore > 0 ? "Hybrid" : "Semantic",
        semantic_boost: Math.round(item.details.semanticScore * 100) / 100
      }));
    
    console.log(`Found ${topResults.length} results, top similarity: ${topResults[0]?.score || 0}`);
    
    res.json(topResults);
    
  } catch (error) {
    console.error("Search error:", error);
    res.status(500).json({ 
      error: "Search failed", 
      details: error.message 
    });
  }
});

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    embeddingsReady: isEmbeddingsReady,
    variableCount: variables.length,
    embeddingCount: embeddings.length
  });
});

// Fallback for the existing mock datasets (for backward compatibility)
app.get("/api/mock-search", (req, res) => {
  const query = (req.query.q || "").toLowerCase();
  
  // This is your existing mock data logic
  const mockDatasets = [
    {
      id: '1',
      title: 'US Census Population Density 2020',
      description: 'Comprehensive population density data for all US metropolitan areas...',
      // ... rest of your mock data
    }
    // Add other mock datasets as needed
  ];
  
  const filtered = mockDatasets.filter(
    d =>
      d.title.toLowerCase().includes(query) ||
      d.description.toLowerCase().includes(query) ||
      (d.tags && d.tags.some(tag => tag.toLowerCase().includes(query)))
  );
  
  res.json(filtered);
});

const PORT = process.env.PORT || 4000;

// Start server after initializing embeddings
initializeEmbeddings().then(() => {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(` Semantic search backend running on port ${PORT}`);
    console.log(` API endpoints:`);
    console.log(`   GET /api/search?q=your+query`);
    console.log(`   GET /api/health`);
    console.log(`   GET /api/mock-search?q=your+query (fallback)`);
  });
}).catch(error => {
  console.error("Failed to start server:", error);
  process.exit(1);
});