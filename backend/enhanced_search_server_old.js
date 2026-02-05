/**
 * Enhanced Geospatial Search Integration
 * ======================================
 * 
 * This module integrates the Python LangGraph agent with the existing
 * geospatial_server.js for enhanced query decomposition and PostGIS search.
 * 
 * Features:
 * - Query decomposition into multiple variable searches
 * - PostGIS metadata and data search
 * - Integration with existing embedding-based search
 * 
 * Author: Claude (based on Sam Spell's geospatial_server.js)
 * Date: 2025
 */

const express = require("express");
const cors = require("cors");
const { spawn } = require("child_process");
const path = require("path");
const { Pool } = require("pg");

// =============================================================================
// Configuration
// =============================================================================

const CONFIG = {
  // LLM Configuration
  llm: {
    endpoint: "http://localhost:11434/api/chat",
    model: "llama3.1",
    temperature: 0.2
  },
  
  // Database Configuration
  database: {
    host: "localhost",
    port: 5432,
    database: "mygisdb",
    user: "samspell",
    password: ""
  },
  
  // Server Configuration
  server: {
    port: process.env.PORT || 4001
  }
};

// =============================================================================
// Database Connection Pool
// =============================================================================

const pool = new Pool(CONFIG.database);

// Test connection
pool.query("SELECT 1")
  .then(() => console.log("✅ PostGIS connection established"))
  .catch(err => console.error("❌ PostGIS connection failed:", err.message));

// =============================================================================
// Query Decomposition via LLM
// =============================================================================

const DECOMPOSITION_PROMPT = `You are a geospatial data analyst expert. Your task is to decompose a natural language query into multiple searchable concepts.

Given a user query about geospatial or demographic data, identify:
1. PRIMARY variables - The main data the user wants (e.g., poverty rates, income, housing)
2. NORMALIZATION variables - Data needed to normalize/compute ratios (e.g., population, area)
3. FILTER variables - Criteria for filtering results (e.g., rural, urban, above threshold)
4. GEOGRAPHIC scope - The geographic level (county, state, tract, block group)
5. TEMPORAL scope - Time period if mentioned
6. RELATED concepts - Variables that might be semantically related to expand the search

Return a JSON object with this structure:
{
    "primary_concepts": ["concept1", "concept2"],
    "normalization_concepts": ["concept1"],
    "filter_concepts": ["concept1"],
    "geographic_level": "county|state|tract|blockgroup|null",
    "temporal_filter": {"start": "year", "end": "year"} or null,
    "related_concepts": ["concept1", "concept2"],
    "search_queries": [
        {"query": "search term 1", "purpose": "primary|normalization|filter|related"},
        {"query": "search term 2", "purpose": "primary|normalization|filter|related"}
    ]
}

User Query: {QUERY}

Return ONLY valid JSON, no other text.`;

/**
 * Call the local LLM for query decomposition
 */
async function callLLM(systemPrompt, userPrompt, temperature = 0.2) {
  try {
    const response = await fetch(CONFIG.llm.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: CONFIG.llm.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: temperature,
        stream: false,
        format: "json"
      })
    });
    
    const data = await response.json();
    return data.message?.content || "";
  } catch (error) {
    console.error("LLM call failed:", error.message);
    throw error;
  }
}

/**
 * Decompose a query into multiple search concepts
 */
async function decomposeQuery(query) {
  console.log(`\n📝 Decomposing query: "${query}"`);
  
  try {
    const prompt = DECOMPOSITION_PROMPT.replace("{QUERY}", query);
    const response = await callLLM(prompt, query);
    
    // Parse JSON from response
    let result;
    try {
      // Try to extract JSON if wrapped in markdown
      let jsonStr = response;
      if (response.includes("```json")) {
        jsonStr = response.split("```json")[1].split("```")[0];
      } else if (response.includes("```")) {
        jsonStr = response.split("```")[1].split("```")[0];
      }
      result = JSON.parse(jsonStr.trim());
    } catch (parseError) {
      // Try direct parse
      result = JSON.parse(response);
    }
    
    console.log(`   ✅ Decomposed into ${result.search_queries?.length || 0} search queries`);
    return result;
    
  } catch (error) {
    console.error(`   ❌ Decomposition failed: ${error.message}`);
    // Return basic decomposition on failure
    return {
      primary_concepts: [query],
      search_queries: [{ query: query, purpose: "primary" }]
    };
  }
}

// =============================================================================
// PostGIS Search Functions
// =============================================================================

/**
 * Search the dataset_metadata table for matching datasets
 */
async function searchMetadata(searchTerms, options = {}) {
  const { geometryType = null, limit = 20 } = options;
  
  console.log(`\n🔍 Searching metadata for: [${searchTerms.join(", ")}]`);
  
  try {
    // Build search conditions
    const conditions = [];
    const params = [];
    let paramIndex = 1;
    
    for (const term of searchTerms) {
      const pattern = `%${term.toLowerCase()}%`;
      conditions.push(`
        (LOWER(dataset_name) LIKE $${paramIndex} 
         OR LOWER(table_name) LIKE $${paramIndex + 1}
         OR EXISTS (
             SELECT 1 FROM unnest(column_list) AS col 
             WHERE LOWER(col) LIKE $${paramIndex + 2}
         ))
      `);
      params.push(pattern, pattern, pattern);
      paramIndex += 3;
    }
    
    let whereClause = conditions.join(" OR ");
    
    if (geometryType) {
      whereClause = `(${whereClause}) AND geometry_type = $${paramIndex}`;
      params.push(geometryType);
      paramIndex++;
    }
    
    params.push(limit);
    
    const query = `
      SELECT 
        id,
        dataset_name,
        table_name,
        source_path,
        geometry_type,
        row_count,
        column_list,
        crs,
        bbox,
        date_ingested
      FROM dataset_metadata
      WHERE ${whereClause}
      ORDER BY row_count DESC NULLS LAST
      LIMIT $${paramIndex}
    `;
    
    const result = await pool.query(query, params);
    console.log(`   ✅ Found ${result.rows.length} matching datasets`);
    
    return result.rows;
    
  } catch (error) {
    console.error(`   ❌ Metadata search failed: ${error.message}`);
    return [];
  }
}

/**
 * Search for specific columns across all tables
 */
async function searchColumns(columnPatterns, limit = 50) {
  console.log(`\n🔍 Searching columns for: [${columnPatterns.join(", ")}]`);
  
  try {
    const results = [];
    
    for (const pattern of columnPatterns) {
      const query = `
        SELECT 
          table_name,
          dataset_name,
          geometry_type,
          array_agg(col) as matching_columns
        FROM dataset_metadata,
             unnest(column_list) AS col
        WHERE LOWER(col) LIKE $1
        GROUP BY table_name, dataset_name, geometry_type
        LIMIT $2
      `;
      
      const result = await pool.query(query, [`%${pattern.toLowerCase()}%`, limit]);
      
      for (const row of result.rows) {
        results.push({
          table_name: row.table_name,
          dataset_name: row.dataset_name,
          geometry_type: row.geometry_type,
          matching_columns: row.matching_columns,
          search_pattern: pattern
        });
      }
    }
    
    console.log(`   ✅ Found ${results.length} column matches`);
    return results;
    
  } catch (error) {
    console.error(`   ❌ Column search failed: ${error.message}`);
    return [];
  }
}

/**
 * Get a sample of data from a table
 */
async function getTableSample(tableName, columns = null, limit = 5) {
  console.log(`\n📊 Sampling table: ${tableName}`);
  
  try {
    const colStr = columns ? columns.map(c => `"${c}"`).join(", ") : "*";
    const query = `SELECT ${colStr} FROM "${tableName}" LIMIT $1`;
    
    const result = await pool.query(query, [limit]);
    console.log(`   ✅ Retrieved ${result.rows.length} sample rows`);
    
    return result.rows;
    
  } catch (error) {
    console.error(`   ❌ Table sample failed: ${error.message}`);
    return [];
  }
}

/**
 * Get statistics for a numeric column
 */
async function getColumnStatistics(tableName, column, groupBy = null) {
  console.log(`\n📈 Getting statistics for ${tableName}.${column}`);
  
  try {
    let query;
    const params = [];
    
    if (groupBy) {
      query = `
        SELECT 
          "${groupBy}",
          COUNT("${column}") as count,
          AVG("${column}"::numeric) as mean,
          MIN("${column}"::numeric) as min,
          MAX("${column}"::numeric) as max,
          STDDEV("${column}"::numeric) as stddev,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY "${column}"::numeric) as median
        FROM "${tableName}"
        WHERE "${column}" IS NOT NULL
        GROUP BY "${groupBy}"
        ORDER BY "${groupBy}"
      `;
    } else {
      query = `
        SELECT 
          COUNT("${column}") as count,
          AVG("${column}"::numeric) as mean,
          MIN("${column}"::numeric) as min,
          MAX("${column}"::numeric) as max,
          STDDEV("${column}"::numeric) as stddev,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY "${column}"::numeric) as median
        FROM "${tableName}"
        WHERE "${column}" IS NOT NULL
      `;
    }
    
    const result = await pool.query(query, params);
    console.log(`   ✅ Statistics calculated`);
    
    return groupBy ? { grouped_statistics: result.rows } : result.rows[0];
    
  } catch (error) {
    console.error(`   ❌ Statistics query failed: ${error.message}`);
    return {};
  }
}

/**
 * Execute a spatial query with optional bbox filter
 */
async function executeSpatialQuery(tableName, options = {}) {
  const { 
    geomColumn = "geom", 
    bbox = null, 
    attributes = null, 
    limit = 100 
  } = options;
  
  console.log(`\n🗺️ Executing spatial query on ${tableName}`);
  
  try {
    const attrStr = attributes 
      ? attributes.map(a => `"${a}"`).join(", ") 
      : "*";
    
    let query = `
      SELECT ${attrStr}, ST_AsGeoJSON("${geomColumn}") as geometry
      FROM "${tableName}"
    `;
    
    const params = [];
    
    if (bbox) {
      const [minx, miny, maxx, maxy] = bbox;
      query += `
        WHERE "${geomColumn}" && ST_MakeEnvelope($1, $2, $3, $4, 4326)
      `;
      params.push(minx, miny, maxx, maxy);
    }
    
    query += ` LIMIT $${params.length + 1}`;
    params.push(limit);
    
    const result = await pool.query(query, params);
    
    // Parse geometry JSON
    const features = result.rows.map(row => {
      if (row.geometry) {
        row.geometry = JSON.parse(row.geometry);
      }
      return row;
    });
    
    console.log(`   ✅ Retrieved ${features.length} features`);
    return features;
    
  } catch (error) {
    console.error(`   ❌ Spatial query failed: ${error.message}`);
    return [];
  }
}

/**
 * Join two tables by FIPS code
 */
async function joinTablesByFips(table1, table2, options = {}) {
  const {
    fipsColumn1 = "fips",
    fipsColumn2 = "fips",
    selectColumns = null,
    limit = 100
  } = options;
  
  console.log(`\n🔗 Joining ${table1} with ${table2} on FIPS`);
  
  try {
    let colStr;
    if (selectColumns) {
      const cols = [];
      for (const [tbl, columns] of Object.entries(selectColumns)) {
        for (const col of columns) {
          cols.push(`"${tbl}"."${col}" as "${tbl}_${col}"`);
        }
      }
      colStr = cols.join(", ");
    } else {
      colStr = `"${table1}".*, "${table2}".*`;
    }
    
    const query = `
      SELECT ${colStr}
      FROM "${table1}"
      INNER JOIN "${table2}" 
        ON "${table1}"."${fipsColumn1}" = "${table2}"."${fipsColumn2}"
      LIMIT $1
    `;
    
    const result = await pool.query(query, [limit]);
    console.log(`   ✅ Joined ${result.rows.length} rows`);
    
    return result.rows;
    
  } catch (error) {
    console.error(`   ❌ Table join failed: ${error.message}`);
    return [];
  }
}

// =============================================================================
// Enhanced Search Pipeline
// =============================================================================

/**
 * Full enhanced search pipeline
 * 
 * 1. Decompose query into concepts
 * 2. Search for each concept
 * 3. Aggregate results
 */
async function enhancedSearch(query, existingSemanticSearch = null) {
  console.log(`\n${"=".repeat(80)}`);
  console.log(`Enhanced Search Pipeline`);
  console.log(`Query: "${query}"`);
  console.log(`${"=".repeat(80)}`);
  
  const startTime = Date.now();
  const results = {
    query: query,
    decomposition: null,
    variable_results: [],
    database_results: [],
    semantic_results: [],
    errors: []
  };
  
  try {
    // STEP 1: Decompose query
    console.log("\n📝 STEP 1: Query Decomposition");
    results.decomposition = await decomposeQuery(query);
    
    // STEP 2: Search for each decomposed concept
    console.log("\n🔍 STEP 2: Variable Search");
    const searchQueries = results.decomposition.search_queries || [];
    
    for (const searchQuery of searchQueries) {
      const term = searchQuery.query;
      const purpose = searchQuery.purpose;
      
      // Search metadata
      const matches = await searchMetadata([term], { limit: 10 });
      
      for (const match of matches) {
        results.variable_results.push({
          ...match,
          search_query: term,
          search_purpose: purpose
        });
      }
      
      // If semantic search function is provided, use it too
      if (existingSemanticSearch) {
        try {
          const semanticMatches = await existingSemanticSearch(term, 5);
          for (const match of semanticMatches) {
            results.semantic_results.push({
              ...match,
              search_query: term,
              search_purpose: purpose
            });
          }
        } catch (e) {
          results.errors.push(`Semantic search error for '${term}': ${e.message}`);
        }
      }
    }
    
    // STEP 3: Get sample data from top matching tables
    console.log("\n📊 STEP 3: Data Sampling");
    const uniqueTables = [...new Set(
      results.variable_results.map(v => v.table_name).filter(Boolean)
    )];
    
    for (const tableName of uniqueTables.slice(0, 5)) {
      try {
        const sample = await getTableSample(tableName, null, 3);
        results.database_results.push({
          table_name: tableName,
          sample_data: sample,
          columns: sample.length > 0 ? Object.keys(sample[0]) : []
        });
      } catch (e) {
        results.errors.push(`Sample error for '${tableName}': ${e.message}`);
      }
    }
    
    // STEP 4: Generate summary
    console.log("\n📋 STEP 4: Generating Summary");
    
    // Group results by purpose
    const byPurpose = {};
    for (const result of results.variable_results) {
      const purpose = result.search_purpose || "unknown";
      if (!byPurpose[purpose]) {
        byPurpose[purpose] = [];
      }
      byPurpose[purpose].push(result);
    }
    
    results.summary = {
      total_matches: results.variable_results.length,
      results_by_purpose: byPurpose,
      available_tables: uniqueTables,
      processing_time_ms: Date.now() - startTime
    };
    
  } catch (error) {
    results.errors.push(`Pipeline error: ${error.message}`);
    console.error(`\n❌ Pipeline error: ${error.message}`);
  }
  
  console.log(`\n${"=".repeat(80)}`);
  console.log(`Enhanced Search Complete (${Date.now() - startTime}ms)`);
  console.log(`Total matches: ${results.variable_results.length}`);
  console.log(`${"=".repeat(80)}\n`);
  
  return results;
}

// =============================================================================
// Express API Routes
// =============================================================================

function createEnhancedRouter(existingSemanticSearch = null) {
  const router = express.Router();
  
  /**
   * POST /api/enhanced-search
   * Full enhanced search pipeline
   */
  router.post("/enhanced-search", async (req, res) => {
    try {
      const { q: query } = req.body;
      
      if (!query || query.trim().length === 0) {
        return res.status(400).json({ 
          error: "Query parameter 'q' is required" 
        });
      }
      
      const results = await enhancedSearch(query, existingSemanticSearch);
      res.json(results);
      
    } catch (error) {
      console.error("Enhanced search error:", error);
      res.status(500).json({ 
        error: "Enhanced search failed", 
        details: error.message 
      });
    }
  });
  
  /**
   * POST /api/decompose-query
   * Just decompose a query without searching
   */
  router.post("/decompose-query", async (req, res) => {
    try {
      const { q: query } = req.body;
      
      if (!query) {
        return res.status(400).json({ error: "Query parameter 'q' is required" });
      }
      
      const decomposition = await decomposeQuery(query);
      res.json(decomposition);
      
    } catch (error) {
      console.error("Decomposition error:", error);
      res.status(500).json({ 
        error: "Decomposition failed", 
        details: error.message 
      });
    }
  });
  
  /**
   * POST /api/search-metadata
   * Search the metadata catalog
   */
  router.post("/search-metadata", async (req, res) => {
    try {
      const { terms, geometry_type, limit } = req.body;
      
      if (!terms || !Array.isArray(terms)) {
        return res.status(400).json({ 
          error: "Parameter 'terms' must be an array" 
        });
      }
      
      const results = await searchMetadata(terms, { 
        geometryType: geometry_type, 
        limit: limit || 20 
      });
      res.json(results);
      
    } catch (error) {
      console.error("Metadata search error:", error);
      res.status(500).json({ 
        error: "Metadata search failed", 
        details: error.message 
      });
    }
  });
  
  /**
   * POST /api/search-columns
   * Search for column names
   */
  router.post("/search-columns", async (req, res) => {
    try {
      const { patterns, limit } = req.body;
      
      if (!patterns || !Array.isArray(patterns)) {
        return res.status(400).json({ 
          error: "Parameter 'patterns' must be an array" 
        });
      }
      
      const results = await searchColumns(patterns, limit || 50);
      res.json(results);
      
    } catch (error) {
      console.error("Column search error:", error);
      res.status(500).json({ 
        error: "Column search failed", 
        details: error.message 
      });
    }
  });
  
  /**
   * POST /api/table-sample
   * Get sample data from a table
   */
  router.post("/table-sample", async (req, res) => {
    try {
      const { table_name, columns, limit } = req.body;
      
      if (!table_name) {
        return res.status(400).json({ error: "Parameter 'table_name' is required" });
      }
      
      const results = await getTableSample(table_name, columns, limit || 5);
      res.json(results);
      
    } catch (error) {
      console.error("Table sample error:", error);
      res.status(500).json({ 
        error: "Table sample failed", 
        details: error.message 
      });
    }
  });
  
  /**
   * POST /api/column-statistics
   * Get statistics for a column
   */
  router.post("/column-statistics", async (req, res) => {
    try {
      const { table_name, column, group_by } = req.body;
      
      if (!table_name || !column) {
        return res.status(400).json({ 
          error: "Parameters 'table_name' and 'column' are required" 
        });
      }
      
      const results = await getColumnStatistics(table_name, column, group_by);
      res.json(results);
      
    } catch (error) {
      console.error("Statistics error:", error);
      res.status(500).json({ 
        error: "Statistics query failed", 
        details: error.message 
      });
    }
  });
  
  /**
   * POST /api/spatial-query
   * Execute a spatial query
   */
  router.post("/spatial-query", async (req, res) => {
    try {
      const { table_name, geom_column, bbox, attributes, limit } = req.body;
      
      if (!table_name) {
        return res.status(400).json({ error: "Parameter 'table_name' is required" });
      }
      
      const results = await executeSpatialQuery(table_name, {
        geomColumn: geom_column || "geom",
        bbox: bbox,
        attributes: attributes,
        limit: limit || 100
      });
      res.json(results);
      
    } catch (error) {
      console.error("Spatial query error:", error);
      res.status(500).json({ 
        error: "Spatial query failed", 
        details: error.message 
      });
    }
  });
  
  /**
   * POST /api/join-tables
   * Join two tables by FIPS
   */
  router.post("/join-tables", async (req, res) => {
    try {
      const { 
        table1, 
        table2, 
        fips_column1, 
        fips_column2, 
        select_columns, 
        limit 
      } = req.body;
      
      if (!table1 || !table2) {
        return res.status(400).json({ 
          error: "Parameters 'table1' and 'table2' are required" 
        });
      }
      
      const results = await joinTablesByFips(table1, table2, {
        fipsColumn1: fips_column1 || "fips",
        fipsColumn2: fips_column2 || "fips",
        selectColumns: select_columns,
        limit: limit || 100
      });
      res.json(results);
      
    } catch (error) {
      console.error("Join tables error:", error);
      res.status(500).json({ 
        error: "Table join failed", 
        details: error.message 
      });
    }
  });
  
  return router;
}

// =============================================================================
// Standalone Server (for testing)
// =============================================================================

if (require.main === module) {
  const app = express();
  app.use(cors());
  app.use(express.json());
  
  // Mount the enhanced search routes
  app.use("/api", createEnhancedRouter());
  
  // Health check
  app.get("/api/health", (req, res) => {
    res.json({
      status: "ok",
      service: "enhanced-geospatial-search",
      database: CONFIG.database.database,
      llm_model: CONFIG.llm.model
    });
  });
  
  const PORT = CONFIG.server.port;
  app.listen(PORT, () => {
    console.log(`\n🚀 Enhanced Geospatial Search Server`);
    console.log(`   Running on: http://localhost:${PORT}`);
    console.log(`\n📡 API Endpoints:`);
    console.log(`   POST /api/enhanced-search     - Full search pipeline`);
    console.log(`   POST /api/decompose-query     - Query decomposition only`);
    console.log(`   POST /api/search-metadata     - Search dataset catalog`);
    console.log(`   POST /api/search-columns      - Search column names`);
    console.log(`   POST /api/table-sample        - Get table sample data`);
    console.log(`   POST /api/column-statistics   - Get column statistics`);
    console.log(`   POST /api/spatial-query       - Execute spatial query`);
    console.log(`   POST /api/join-tables         - Join tables by FIPS`);
    console.log(`   GET  /api/health              - Health check`);
    console.log(`\n🔧 Configuration:`);
    console.log(`   LLM Model: ${CONFIG.llm.model}`);
    console.log(`   Database: ${CONFIG.database.database}`);
  });
}

// =============================================================================
// Exports for integration with geospatial_server.js
// =============================================================================

module.exports = {
  // Configuration
  CONFIG,
  
  // Core functions
  decomposeQuery,
  searchMetadata,
  searchColumns,
  getTableSample,
  getColumnStatistics,
  executeSpatialQuery,
  joinTablesByFips,
  
  // Full pipeline
  enhancedSearch,
  
  // Express router factory
  createEnhancedRouter,
  
  // Database pool (for direct access if needed)
  pool
};
