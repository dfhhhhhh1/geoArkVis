/**
 * Enhanced Multi-Search Server with BGE Embeddings and LLM Filtering
 * ===================================================================
 * 
 * This module integrates:
 * 1. BGE embeddings (BAAI/bge-base-en-v1.5) for semantic search
 * 2. Query decomposition into multiple search concepts
 * 3. LLM agent for filtering/refining search results
 * 4. PostGIS integration via dataset_id and table_name
 * 
 * Based on server_e5_test.js and geoark_attributes.csv format from attr_gen_copy.py
 * 
 * Author: Claude (based on Sam Spell's architecture)
 * Date: 2025
 */

const express = require("express");
const cors = require("cors");
const csv = require("csv-parser");
const fs = require("fs");
const { spawn } = require("child_process");
const path = require("path");
const { Pool } = require("pg");

console.log("🚀 Starting Enhanced Multi-Search Server with BGE Embeddings...");

const app = express();
app.use(cors());
app.use(express.json());

// =============================================================================
// Configuration
// =============================================================================

const CONFIG = {
  llm: {
    endpoint: "http://localhost:11434/api/chat",
    model: "gemma3:4b",  // Your local model
    temperature: 0.2
  },
  database: {
    host: "localhost",
    port: 5432,
    database: "mygisdb",
    user: "samspell",
    password: ""
  },
  search: {
    semanticWeight: 0.7,
    keywordWeight: 0.3,
    topK: 10,  // Results per search concept
    csvPath: "geoark_attributes.csv"
  }
};

// Database pool for PostGIS queries
const pool = new Pool(CONFIG.database);

// In-memory storage
let variables = [];
let embeddings = [];
let processedVariablesText = [];
let isEmbeddingsReady = false;

// =============================================================================
// CSV Loading - Based on attr_gen_copy.py format
// =============================================================================

/**
 * CSV columns from attr_gen_copy.py:
 * - dataset_id: Unique ID for the dataset (e.g., "8f3a2b1c_01_01")
 * - dataset_name: Original table name
 * - table_name: Actual PostGIS table name
 * - dataset_clean: Human readable name
 * - source_folder: Source folder name
 * - attr_label: Attribute ID (e.g., "8f3a2b1c_01_01_01")
 * - attr_orig: Original column name
 * - attr_desc: Human readable column description
 * - tags: LLM-generated search tags
 * - entity_type: Geographic level (COUNTY, STATE, etc.)
 * - spatial_rep: Geometry type (POLYGON, POINT, etc.)
 */
function createEmbeddingText(row) {
  const parts = [];
  
  // Include dataset context
  if (row.dataset_clean) parts.push(row.dataset_clean.trim());
  if (row.source_folder) parts.push(row.source_folder.trim());
  
  // Include attribute info
  if (row.attr_desc) parts.push(row.attr_desc.trim());
  if (row.attr_orig) parts.push(row.attr_orig.replace(/_/g, ' ').trim());
  
  // Include tags (most important for search)
  if (row.tags) {
    try {
      const cleanTags = row.tags
        .replace(/[\[\]'\"]/g, '')
        .split(',')
        .map(tag => tag.trim())
        .filter(tag => tag.length > 0);
      parts.push(...cleanTags);
    } catch (e) {
      parts.push(row.tags.trim());
    }
  }
  
  // Include entity type
  if (row.entity_type) parts.push(row.entity_type.trim());
  
  return parts.join(' ').toLowerCase();
}

async function loadVariablesFromCSV(csvFilePath) {
  return new Promise((resolve, reject) => {
    const results = [];
    
    fs.createReadStream(csvFilePath)
      .pipe(csv())
      .on('data', (row) => {
        const embeddingText = createEmbeddingText(row);
        
        results.push({
          // IDs for database lookup
          dataset_id: row.dataset_id || '',
          table_name: row.table_name || '',
          attr_id: row.attr_label || '',
          attr_orig: row.attr_orig || '',  // Original column name for SQL
          
          // Display info
          dataset_clean: row.dataset_clean || '',
          attr_desc: row.attr_desc || '',
          source_folder: row.source_folder || '',
          
          // Metadata
          tags: row.tags || '',
          entity_type: row.entity_type || '',
          spatial_rep: row.spatial_rep || '',
          start_date: row.start_date || '',
          end_date: row.end_date || '',
          
          // For embedding
          embeddingText: embeddingText
        });
      })
      .on('end', () => {
        console.log(`📊 Loaded ${results.length} variables from CSV`);
        resolve(results);
      })
      .on('error', reject);
  });
}

// =============================================================================
// BGE Embeddings - From server_e5_test.js
// =============================================================================

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
    nltk.download('wordnet', quiet=True)
    nltk.download('omw-1.4', quiet=True)

lemmatizer = WordNetLemmatizer()

def clean_and_lemmatize(text):
    # Remove special characters
    text = re.sub(r'[\\|\\"\\(\\)\\[\\]\\{\\}\\/\\,]', ' ', text)
    # Lowercase and split
    words = text.lower().split()
    # Lemmatize
    lemmatized = [lemmatizer.lemmatize(w) for w in words]
    return " ".join(lemmatized)

def main():
    model = SentenceTransformer('BAAI/bge-base-en-v1.5')
    input_data = json.loads(sys.stdin.read())
    texts = input_data['texts']
    is_query = input_data.get('is_query', False)
    
    # Process texts
    processed_texts = [clean_and_lemmatize(t) for t in texts]
    
    # For BGE, queries need a special prefix
    if is_query:
        processed_texts = [f"Represent this sentence for searching relevant passages: {t}" for t in processed_texts]
    
    # Generate embeddings
    embeddings = model.encode(processed_texts)
    
    result = {
        'embeddings': embeddings.tolist(),
        'processed_texts': [clean_and_lemmatize(t) for t in texts],  # Return without prefix
        'dimension': len(embeddings[0]) if len(embeddings) > 0 else 0
    }
    print(json.dumps(result))

if __name__ == '__main__':
    main()
`;

async function generateEmbeddings(texts, isQuery = false) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, 'temp_bge_embedding.py');
    fs.writeFileSync(scriptPath, pythonEmbeddingScript);
    
    const python = spawn('python3', [scriptPath]);
    let output = '';
    let errorOutput = '';
    
    python.stdin.on('error', (err) => {
      console.error('Python stdin error:', err.message);
    });

    try {
      python.stdin.write(JSON.stringify({ texts, is_query: isQuery }));
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
      try { fs.unlinkSync(scriptPath); } catch (e) {}
      
      if (code !== 0) {
        reject(new Error(`Python script failed: ${errorOutput}`));
        return;
      }
      
      try {
        resolve(JSON.parse(output));
      } catch (e) {
        reject(new Error(`Failed to parse embedding result: ${e.message}`));
      }
    });
    
    python.on('error', (err) => {
      reject(new Error(`Failed to spawn Python: ${err.message}`));
    });
  });
}

// =============================================================================
// Similarity Functions
// =============================================================================

function cosineSimilarity(vecA, vecB) {
  if (vecA.length !== vecB.length) {
    throw new Error('Vectors must be the same length');
  }
  
  let dotProduct = 0, normA = 0, normB = 0;
  
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  
  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);
  
  return (normA === 0 || normB === 0) ? 0 : dotProduct / (normA * normB);
}

function getKeywordScore(queryProcessed, documentProcessed) {
  const queryWords = new Set(queryProcessed.split(/\s+/).filter(w => w.length > 2));
  const docWords = new Set(documentProcessed.split(/\s+/));
  
  let matches = 0;
  queryWords.forEach(word => {
    if (docWords.has(word)) matches++;
  });
  
  return queryWords.size > 0 ? matches / queryWords.size : 0;
}

// =============================================================================
// Core Search Function - Hybrid BGE + Keyword
// =============================================================================

async function performHybridSearch(query, topK = CONFIG.search.topK) {
  if (!isEmbeddingsReady) {
    throw new Error("Embeddings not ready");
  }
  
  console.log(`   🔍 Hybrid search for: "${query}"`);
  
  // Generate query embedding with BGE prefix
  const queryResult = await generateEmbeddings([query], true);
  const queryEmbedding = queryResult.embeddings[0];
  const queryProcessed = queryResult.processed_texts[0];
  
  // Calculate hybrid scores
  const results = embeddings.map((emb, i) => {
    const semanticScore = cosineSimilarity(queryEmbedding, emb);
    const keywordScore = getKeywordScore(queryProcessed, processedVariablesText[i]);
    const hybridScore = (semanticScore * CONFIG.search.semanticWeight) + 
                        (keywordScore * CONFIG.search.keywordWeight);
    
    return {
      variable: variables[i],
      score: hybridScore,
      semanticScore,
      keywordScore
    };
  });
  
  // Sort and return top results
  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(item => ({
      // Database lookup keys
      dataset_id: item.variable.dataset_id,
      table_name: item.variable.table_name,
      attr_id: item.variable.attr_id,
      attr_orig: item.variable.attr_orig,  // Actual column name for SQL
      
      // Display info
      dataset_clean: item.variable.dataset_clean,
      attr_desc: item.variable.attr_desc,
      source_folder: item.variable.source_folder,
      tags: item.variable.tags,
      entity_type: item.variable.entity_type,
      spatial_rep: item.variable.spatial_rep,
      
      // Scores
      score: Math.round(item.score * 1000) / 1000,
      semantic_score: Math.round(item.semanticScore * 1000) / 1000,
      keyword_score: Math.round(item.keywordScore * 1000) / 1000,
      match_type: item.keywordScore > 0 ? "hybrid" : "semantic"
    }));
}

// =============================================================================
// Query Decomposition - Smart Fallback (no LLM dependency)
// =============================================================================

function decomposeQuerySmart(query) {
  console.log(`\n📝 Decomposing query: "${query}"`);
  
  const lowerQuery = query.toLowerCase();
  const searchQueries = [];
  const primaryConcepts = [];
  const normalizationConcepts = [];
  const filterConcepts = [];
  
  // Normalization keywords
  const normalizationPatterns = [
    { pattern: /per\s*capita/i, concept: "population" },
    { pattern: /per\s*person/i, concept: "population" },
    { pattern: /per\s*household/i, concept: "households" },
    { pattern: /per\s*sq(uare)?\s*(mile|km|meter)/i, concept: "area land" },
    { pattern: /normaliz/i, concept: "population" },
    { pattern: /\brate\b/i, concept: "total" },
    { pattern: /percent(age)?/i, concept: "total" },
    { pattern: /ratio/i, concept: "total" }
  ];
  
  // Filter keywords
  const filterPatterns = [
    { pattern: /\brural\b/i, concept: "rural" },
    { pattern: /\burban\b/i, concept: "urban" },
    { pattern: /\bsuburban\b/i, concept: "suburban" },
    { pattern: /\bmetro(politan)?\b/i, concept: "metropolitan" },
    { pattern: /\bhigh\b/i, concept: "high" },
    { pattern: /\blow\b/i, concept: "low" }
  ];
  
  // Geographic keywords (for context, not search)
  const geoPatterns = [
    { pattern: /\bcounty\b|\bcounties\b/i, level: "COUNTY" },
    { pattern: /\bstate\b|\bstates\b/i, level: "STATE" },
    { pattern: /\btract\b|\btracts\b/i, level: "TRACT" },
    { pattern: /\bblock\s*group\b/i, level: "BLOCKGROUP" },
    { pattern: /\bzip\b|\bzip\s*code\b/i, level: "ZIP" }
  ];
  
  // Check for normalization needs
  for (const { pattern, concept } of normalizationPatterns) {
    if (pattern.test(lowerQuery)) {
      normalizationConcepts.push(concept);
      searchQueries.push({ query: concept, purpose: "normalization" });
    }
  }
  
  // Check for filters
  for (const { pattern, concept } of filterPatterns) {
    if (pattern.test(lowerQuery)) {
      filterConcepts.push(concept);
      // Don't add as search query - will be used for filtering results
    }
  }
  
  // Detect geographic level
  let geographicLevel = null;
  for (const { pattern, level } of geoPatterns) {
    if (pattern.test(lowerQuery)) {
      geographicLevel = level;
      break;
    }
  }
  
  // Split query into primary concepts
  // Remove normalization, filter, and geo terms first
  let cleanedQuery = query;
  
  // Remove common phrases
  const removePatterns = [
    /per\s*(capita|person|household|sq\w*\s*\w+)/gi,
    /normaliz\w*/gi,
    /\b(for|in|by|the|and|or|with|show|me|get|find)\b/gi,
    /\b(county|counties|state|states|tract|tracts|block\s*group|zip\s*code?)\b/gi,
    /\b(rural|urban|suburban|metro|metropolitan)\b/gi,
    /\b(area|areas|region|regions)\b/gi
  ];
  
  for (const pattern of removePatterns) {
    cleanedQuery = cleanedQuery.replace(pattern, ' ');
  }
  
  // Split by delimiters
  const parts = cleanedQuery
    .split(/[,;]|\band\b|\bor\b/i)
    .map(p => p.trim())
    .filter(p => p.length > 2);
  
  // Add each part as a primary search
  for (const part of parts) {
    if (part.length > 2) {
      primaryConcepts.push(part);
      searchQueries.push({ query: part, purpose: "primary" });
    }
  }
  
  // If no concepts found, use original query
  if (searchQueries.length === 0) {
    searchQueries.push({ query: query, purpose: "primary" });
    primaryConcepts.push(query);
  }
  
  // Remove duplicate search queries
  const uniqueQueries = [];
  const seen = new Set();
  for (const sq of searchQueries) {
    const key = sq.query.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      uniqueQueries.push(sq);
    }
  }
  
  const result = {
    original_query: query,
    primary_concepts: primaryConcepts,
    normalization_concepts: [...new Set(normalizationConcepts)],
    filter_concepts: [...new Set(filterConcepts)],
    geographic_level: geographicLevel,
    search_queries: uniqueQueries
  };
  
  console.log(`   ✅ Created ${uniqueQueries.length} search queries`);
  console.log(`      Primary: [${primaryConcepts.join(', ')}]`);
  if (normalizationConcepts.length > 0) {
    console.log(`      Normalization: [${normalizationConcepts.join(', ')}]`);
  }
  if (filterConcepts.length > 0) {
    console.log(`      Filters: [${filterConcepts.join(', ')}]`);
  }
  if (geographicLevel) {
    console.log(`      Geographic level: ${geographicLevel}`);
  }
  
  return result;
}

// =============================================================================
// LLM Filtering Agent - Refines search results
// =============================================================================

async function filterResultsWithLLM(originalQuery, results, decomposition) {
  console.log(`\n🤖 LLM filtering ${results.length} results...`);
  
  // Skip if too few results
  if (results.length <= 5) {
    console.log(`   ⏭️ Skipping LLM filter (only ${results.length} results)`);
    return results.map(r => ({ ...r, llm_relevant: true, llm_reason: "auto-included" }));
  }
  
  const prompt = `You are filtering search results for a geospatial data query.

QUERY: "${originalQuery}"
PRIMARY CONCEPTS: ${decomposition.primary_concepts.join(', ')}
${decomposition.normalization_concepts.length > 0 ? `NORMALIZATION NEEDED: ${decomposition.normalization_concepts.join(', ')}` : ''}
${decomposition.geographic_level ? `GEOGRAPHIC LEVEL: ${decomposition.geographic_level}` : ''}

SEARCH RESULTS (showing top ${Math.min(results.length, 20)}):
${results.slice(0, 20).map((r, i) => 
  `${i + 1}. [${r.attr_id}] ${r.dataset_clean} - ${r.attr_desc} | Tags: ${r.tags} | Entity: ${r.entity_type}`
).join('\n')}

For each result, determine if it's RELEVANT to the query.
Return a JSON array of objects with "index" (1-based) and "relevant" (true/false).
Only include results that DIRECTLY relate to the query concepts.

Example response:
[{"index": 1, "relevant": true}, {"index": 2, "relevant": false}]

Return ONLY the JSON array:`;

  try {
    const response = await fetch(CONFIG.llm.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: CONFIG.llm.model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        stream: false
      })
    });
    
    if (!response.ok) {
      throw new Error(`LLM returned ${response.status}`);
    }
    
    const data = await response.json();
    const content = data.message?.content || "";
    
    // Parse response
    let relevanceData;
    try {
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        relevanceData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON array found");
      }
    } catch (e) {
      console.log(`   ⚠️ Could not parse LLM response, keeping all results`);
      return results.map(r => ({ ...r, llm_relevant: true, llm_reason: "parse-failed" }));
    }
    
    // Apply relevance scores
    const relevanceMap = new Map();
    for (const item of relevanceData) {
      relevanceMap.set(item.index, item.relevant);
    }
    
    const filteredResults = results.map((r, i) => ({
      ...r,
      llm_relevant: relevanceMap.get(i + 1) ?? true,
      llm_reason: relevanceMap.has(i + 1) ? "llm-filtered" : "not-evaluated"
    }));
    
    const relevantCount = filteredResults.filter(r => r.llm_relevant).length;
    console.log(`   ✅ LLM marked ${relevantCount}/${results.length} as relevant`);
    
    return filteredResults;
    
  } catch (error) {
    console.log(`   ⚠️ LLM filtering failed: ${error.message}`);
    return results.map(r => ({ ...r, llm_relevant: true, llm_reason: "error-fallback" }));
  }
}

// =============================================================================
// Multi-Search Pipeline
// =============================================================================

async function multiSearch(query, options = {}) {
  const {
    useLLMFilter = true,
    topKPerConcept = CONFIG.search.topK,
    maxTotalResults = 30
  } = options;
  
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🔎 Multi-Search Pipeline`);
  console.log(`   Query: "${query}"`);
  console.log(`${'='.repeat(80)}`);
  
  const startTime = Date.now();
  
  // Step 1: Decompose query
  const decomposition = decomposeQuerySmart(query);
  
  // Step 2: Run searches for each concept
  console.log(`\n🔍 STEP 2: Running ${decomposition.search_queries.length} searches...`);
  
  const allResults = {
    primary: [],
    normalization: [],
    filter: [],
    related: []
  };
  
  for (const sq of decomposition.search_queries) {
    console.log(`   Searching: "${sq.query}" (${sq.purpose})`);
    
    try {
      const results = await performHybridSearch(sq.query, topKPerConcept);
      
      // Tag results with search metadata
      const taggedResults = results.map(r => ({
        ...r,
        search_query: sq.query,
        search_purpose: sq.purpose
      }));
      
      // Add to appropriate bucket
      const bucket = allResults[sq.purpose] || allResults.primary;
      bucket.push(...taggedResults);
      
      console.log(`      Found ${results.length} results`);
    } catch (e) {
      console.log(`      ❌ Error: ${e.message}`);
    }
  }
  
  // Step 3: Filter by geographic level if specified
  if (decomposition.geographic_level) {
    console.log(`\n📍 Filtering by geographic level: ${decomposition.geographic_level}`);
    
    for (const key of Object.keys(allResults)) {
      const before = allResults[key].length;
      allResults[key] = allResults[key].filter(r => 
        !r.entity_type || 
        r.entity_type.toUpperCase() === decomposition.geographic_level
      );
      const after = allResults[key].length;
      if (before !== after) {
        console.log(`   ${key}: ${before} → ${after} results`);
      }
    }
  }
  
  // Step 4: Deduplicate
  console.log(`\n🔄 Deduplicating results...`);
  const seen = new Set();
  const deduplicatedResults = [];
  
  // Process in order: primary first, then normalization
  for (const purpose of ['primary', 'normalization', 'filter', 'related']) {
    for (const result of allResults[purpose]) {
      const key = result.attr_id;
      if (!seen.has(key)) {
        seen.add(key);
        deduplicatedResults.push(result);
      }
    }
  }
  
  console.log(`   Total unique results: ${deduplicatedResults.length}`);
  
  // Step 5: LLM filtering (optional)
  let finalResults = deduplicatedResults;
  if (useLLMFilter && deduplicatedResults.length > 5) {
    finalResults = await filterResultsWithLLM(query, deduplicatedResults, decomposition);
  }
  
  // Step 6: Sort and limit
  finalResults = finalResults
    .sort((a, b) => {
      // Prioritize LLM-relevant results
      if (a.llm_relevant !== b.llm_relevant) {
        return a.llm_relevant ? -1 : 1;
      }
      // Then by score
      return b.score - a.score;
    })
    .slice(0, maxTotalResults);
  
  // Step 7: Group by purpose for output
  const resultsByPurpose = {
    primary: finalResults.filter(r => r.search_purpose === 'primary'),
    normalization: finalResults.filter(r => r.search_purpose === 'normalization'),
    filter: finalResults.filter(r => r.search_purpose === 'filter'),
    related: finalResults.filter(r => r.search_purpose === 'related')
  };
  
  const elapsed = Date.now() - startTime;
  
  console.log(`\n${'='.repeat(80)}`);
  console.log(`✅ Multi-Search Complete (${elapsed}ms)`);
  console.log(`   Primary: ${resultsByPurpose.primary.length}`);
  console.log(`   Normalization: ${resultsByPurpose.normalization.length}`);
  console.log(`   Total: ${finalResults.length}`);
  console.log(`${'='.repeat(80)}\n`);
  
  return {
    query,
    decomposition,
    results_by_purpose: resultsByPurpose,
    all_results: finalResults,
    stats: {
      total_results: finalResults.length,
      primary_count: resultsByPurpose.primary.length,
      normalization_count: resultsByPurpose.normalization.length,
      processing_time_ms: elapsed,
      llm_filtered: useLLMFilter
    }
  };
}

// =============================================================================
// PostGIS Data Retrieval
// =============================================================================

/**
 * Get actual data from PostGIS using the search results
 */
async function getDataFromResults(searchResults, options = {}) {
  const { limit = 10, fipsFilter = null } = options;
  
  const data = [];
  
  // Group results by table
  const byTable = new Map();
  for (const result of searchResults) {
    if (!result.table_name || !result.attr_orig) continue;
    
    if (!byTable.has(result.table_name)) {
      byTable.set(result.table_name, []);
    }
    byTable.get(result.table_name).push(result.attr_orig);
  }
  
  // Query each table
  for (const [tableName, columns] of byTable) {
    try {
      // Build query with selected columns
      const colList = columns.map(c => `"${c}"`).join(', ');
      let query = `SELECT ${colList} FROM "${tableName}"`;
      const params = [];
      
      if (fipsFilter) {
        // Try to find FIPS column
        query += ` WHERE fips = $1 OR geoid = $1`;
        params.push(fipsFilter);
      }
      
      query += ` LIMIT ${limit}`;
      
      const result = await pool.query(query, params);
      
      data.push({
        table_name: tableName,
        columns: columns,
        rows: result.rows,
        row_count: result.rowCount
      });
      
    } catch (e) {
      console.error(`Failed to query ${tableName}: ${e.message}`);
    }
  }
  
  return data;
}

// =============================================================================
// API Endpoints
// =============================================================================

/**
 * POST /api/multi-search
 * Main endpoint for decomposed multi-search
 */
app.post("/api/multi-search", async (req, res) => {
  try {
    if (!isEmbeddingsReady) {
      return res.status(503).json({ error: "Embeddings not ready" });
    }
    
    const { q: query, use_llm_filter = true, top_k = 15 } = req.body;
    
    if (!query || query.trim().length === 0) {
      return res.status(400).json({ error: "Query 'q' is required" });
    }
    
    const results = await multiSearch(query, {
      useLLMFilter: use_llm_filter,
      topKPerConcept: top_k
    });
    
    res.json(results);
    
  } catch (error) {
    console.error("Multi-search error:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/search
 * Simple single search (backward compatible)
 */
app.get("/api/search", async (req, res) => {
  try {
    if (!isEmbeddingsReady) {
      return res.status(503).json({ error: "Embeddings not ready" });
    }
    
    const query = req.query.q;
    if (!query) {
      return res.json([]);
    }
    
    const results = await performHybridSearch(query, 20);
    res.json(results);
    
  } catch (error) {
    console.error("Search error:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/get-data
 * Retrieve actual data from PostGIS based on search results
 */
app.post("/api/get-data", async (req, res) => {
  try {
    const { results, limit = 10, fips = null } = req.body;
    
    if (!results || !Array.isArray(results)) {
      return res.status(400).json({ error: "Results array required" });
    }
    
    const data = await getDataFromResults(results, { limit, fipsFilter: fips });
    res.json(data);
    
  } catch (error) {
    console.error("Get data error:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/decompose
 * Just decompose a query (for debugging)
 */
app.post("/api/decompose", (req, res) => {
  const { q: query } = req.body;
  
  if (!query) {
    return res.status(400).json({ error: "Query 'q' is required" });
  }
  
  const decomposition = decomposeQuerySmart(query);
  res.json(decomposition);
});

/**
 * GET /api/health
 */
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    embeddings_ready: isEmbeddingsReady,
    variable_count: variables.length,
    embedding_count: embeddings.length,
    model: "BAAI/bge-base-en-v1.5",
    llm_model: CONFIG.llm.model
  });
});

// =============================================================================
// Initialization
// =============================================================================

async function initializeEmbeddings() {
  try {
    console.log("📊 Loading variables from CSV...");
    
    if (!fs.existsSync(CONFIG.search.csvPath)) {
      throw new Error(`CSV not found: ${CONFIG.search.csvPath}`);
    }
    
    variables = await loadVariablesFromCSV(CONFIG.search.csvPath);
    
    if (variables.length === 0) {
      throw new Error("No variables loaded");
    }
    
    console.log("🧠 Generating BGE embeddings in batches...");
    const texts = variables.map(v => v.embeddingText);
    const BATCH_SIZE = 500;
    embeddings = [];
    processedVariablesText = [];
    
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      console.log(`   Batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(texts.length/BATCH_SIZE)}...`);
      
      const result = await generateEmbeddings(batch, false);
      embeddings.push(...result.embeddings);
      processedVariablesText.push(...result.processed_texts);
    }
    
    console.log(`✅ Generated ${embeddings.length} embeddings`);
    isEmbeddingsReady = true;
    
  } catch (error) {
    console.error("❌ Failed to initialize:", error.message);
    process.exit(1);
  }
}

// =============================================================================
// Start Server
// =============================================================================

const PORT = process.env.PORT || 4000;

initializeEmbeddings().then(() => {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`\n🚀 Enhanced Multi-Search Server`);
    console.log(`   Running on: http://localhost:${PORT}`);
    console.log(`\n📡 Endpoints:`);
    console.log(`   POST /api/multi-search  - Decomposed multi-concept search`);
    console.log(`   GET  /api/search        - Simple hybrid search`);
    console.log(`   POST /api/get-data      - Retrieve PostGIS data`);
    console.log(`   POST /api/decompose     - Query decomposition only`);
    console.log(`   GET  /api/health        - Health check`);
    console.log(`\n🔧 Config:`);
    console.log(`   Embedding Model: BAAI/bge-base-en-v1.5`);
    console.log(`   LLM Model: ${CONFIG.llm.model}`);
    console.log(`   Variables: ${variables.length}`);
  });
}).catch(error => {
  console.error("Failed to start:", error);
  process.exit(1);
});

// =============================================================================
// Export for integration
// =============================================================================

module.exports = {
  performHybridSearch,
  decomposeQuerySmart,
  multiSearch,
  getDataFromResults,
  CONFIG
};
