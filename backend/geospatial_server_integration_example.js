/**
 * Geospatial Server with Enhanced Search Integration
 * ===================================================
 * 
 * This file shows how to integrate the enhanced search capabilities
 * with your existing geospatial_server.js
 * 
 * Key additions:
 * 1. Query decomposition before embedding search
 * 2. PostGIS database search in parallel with embedding search
 * 3. Combined results with normalization variable detection
 */

const express = require("express");
const cors = require("cors");
const csv = require("csv-parser");
const fs = require("fs");
const { spawn } = require("child_process");

// Import enhanced search module
const enhancedSearch = require("./enhanced_search_server");

const app = express();
app.use(cors());
app.use(express.json());

// Configuration
const LOCAL_LLM_ENDPOINT = "http://localhost:11434/api/chat";
const LOCAL_LLM_MODEL = "gemma3:4b";

let variables = [];
let embeddings = [];
let isEmbeddingsReady = false;

// ==================== EMBEDDING FUNCTIONS ====================
// (Include your existing embedding functions here - createEmbeddingText, 
//  loadVariablesFromCSV, generateEmbeddings, cosineSimilarity, etc.)

// ==================== SEMANTIC SEARCH ====================

async function performSemanticSearch(query, topK = 20) {
  // Your existing semantic search implementation
  // ...
}

// ==================== LLM FUNCTIONS ====================

async function callLocalLLM(systemPrompt, userPrompt, temperature = 0.2) {
  // Your existing LLM call implementation
  // ...
}

// ==================== ENHANCED ENDPOINT ====================

/**
 * NEW: Enhanced parse-query endpoint
 * 
 * This endpoint:
 * 1. Decomposes the query into multiple search concepts
 * 2. Searches for EACH concept separately (primary, normalization, etc.)
 * 3. Searches PostGIS metadata in parallel
 * 4. Combines results and generates IR/DAG
 */
app.post("/api/parse-query-enhanced", async (req, res) => {
  try {
    const { q: query } = req.body;
    
    if (!query || query.trim().length === 0) {
      return res.status(400).json({ error: "Query parameter 'q' is required" });
    }
    
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Enhanced Pipeline Started: "${query}"`);
    console.log(`${'='.repeat(80)}\n`);
    
    // STEP 1: Decompose query
    console.log('STEP 1: Query Decomposition');
    const decomposition = await enhancedSearch.decomposeQuery(query);
    
    // STEP 2: Multi-concept semantic search
    console.log('STEP 2: Multi-Concept Semantic Search');
    const searchQueries = decomposition.search_queries || [{ query, purpose: 'primary' }];
    
    const semanticResults = { primary: [], normalization: [], filter: [], related: [] };
    
    for (const sq of searchQueries) {
      console.log(`   Searching: "${sq.query}" (${sq.purpose})`);
      const results = await performSemanticSearch(sq.query, 10);
      
      results.forEach(r => {
        r.search_query = sq.query;
        r.search_purpose = sq.purpose;
      });
      
      const bucket = semanticResults[sq.purpose] || semanticResults.primary;
      bucket.push(...results);
    }
    
    // STEP 3: PostGIS metadata search
    console.log('STEP 3: PostGIS Metadata Search');
    const allTerms = searchQueries.map(sq => sq.query);
    const metadataResults = await enhancedSearch.searchMetadata(allTerms, { limit: 20 });
    
    // STEP 4: Combine results
    console.log('STEP 4: Combining Results');
    const allResults = [
      ...semanticResults.primary,
      ...semanticResults.normalization,
      ...semanticResults.filter,
      ...semanticResults.related
    ];
    
    // Deduplicate
    const seen = new Set();
    const uniqueResults = allResults.filter(r => {
      if (seen.has(r.attr_id)) return false;
      seen.add(r.attr_id);
      return true;
    });
    
    uniqueResults.sort((a, b) => b.similarity - a.similarity);
    
    // STEP 5 & 6: Generate IR and DAG using combined results
    // (Use your existing generateIRFromQuery and generateDAGFromIR)
    
    res.json({
      query,
      decomposition,
      results_by_purpose: semanticResults,
      top_variables: uniqueResults.slice(0, 20),
      postgis_matches: metadataResults,
      // ir: ir,
      // dag: dag,
      stats: {
        total_matches: allResults.length,
        unique_variables: uniqueResults.length,
        postgis_matches: metadataResults.length
      }
    });
    
  } catch (error) {
    console.error("Enhanced parse error:", error);
    res.status(500).json({ error: "Failed to parse query", details: error.message });
  }
});

// Mount enhanced search routes
app.use("/api", enhancedSearch.createEnhancedRouter(performSemanticSearch));

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    embeddingsReady: isEmbeddingsReady,
    enhancedSearchEnabled: true
  });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`\nNew Enhanced Endpoints:`);
  console.log(`  POST /api/parse-query-enhanced  - Full enhanced pipeline`);
  console.log(`  POST /api/enhanced-search       - Enhanced search only`);
  console.log(`  POST /api/decompose-query       - Query decomposition`);
  console.log(`  POST /api/search-metadata       - PostGIS metadata search`);
});
