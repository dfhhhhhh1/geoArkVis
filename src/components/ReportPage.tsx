import { useState, useMemo, useCallback } from 'react';
import Papa from 'papaparse';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Line, Bar, Pie, Scatter } from 'react-chartjs-2';
import Skeleton from 'react-loading-skeleton';
import 'react-loading-skeleton/dist/skeleton.css';
import {
  Upload,
  AlertCircle,
  TrendingUp,
  BarChart3,
  Search,
  Loader2,
  Sparkles,
  Database,
  Brain,
  Map,
  GitBranch,
  ChevronDown,
  ChevronUp,
  Download,
  Table,
  Activity,
} from 'lucide-react';
import _ from 'lodash';
import type {
  UnifiedSearchResponse,
  UnifiedSearchResultItem,
} from '../types';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

// ============================================================
// Interfaces
// ============================================================

interface ParsedData {
  headers: string[];
  rows: Record<string, string | number>[];
}

interface ColumnStats {
  column: string;
  count: number;
  missing: number;
  sum: number;
  avg: number;
  median: number;
  stdDev: number;
  min: number;
  max: number;
  p25: number;
  p75: number;
}

interface CategoricalStats {
  column: string;
  uniqueCount: number;
  topValues: Array<{ value: string; count: number }>;
  missing: number;
}

interface ClusterResult {
  centroid: number[];
  points: number[][];
  labels: string[];
  size: number;
}

interface RegressionResult {
  slope: number;
  intercept: number;
  rSquared: number;
  predictions: number[];
  xColumn: string;
  yColumn: string;
}

// ============================================================
// ML Utility Functions (client-side)
// ============================================================

/** K-Means clustering (simple implementation) */
function kMeansClustering(
  data: number[][],
  k: number,
  maxIter: number = 50
): { assignments: number[]; centroids: number[][] } {
  if (data.length === 0 || k <= 0) return { assignments: [], centroids: [] };

  const dim = data[0].length;
  // Initialize centroids via random sampling
  const indices = new Set<number>();
  while (indices.size < Math.min(k, data.length)) {
    indices.add(Math.floor(Math.random() * data.length));
  }
  let centroids = Array.from(indices).map(i => [...data[i]]);
  let assignments = new Array(data.length).fill(0);

  for (let iter = 0; iter < maxIter; iter++) {
    // Assign points
    const newAssignments = data.map(point => {
      let minDist = Infinity;
      let closest = 0;
      centroids.forEach((centroid, ci) => {
        const dist = point.reduce((sum, val, d) => sum + (val - centroid[d]) ** 2, 0);
        if (dist < minDist) {
          minDist = dist;
          closest = ci;
        }
      });
      return closest;
    });

    // Check convergence
    if (newAssignments.every((a, i) => a === assignments[i])) break;
    assignments = newAssignments;

    // Update centroids
    centroids = centroids.map((_, ci) => {
      const clusterPoints = data.filter((_, pi) => assignments[pi] === ci);
      if (clusterPoints.length === 0) return centroids[ci];
      return Array.from({ length: dim }, (_, d) =>
        clusterPoints.reduce((sum, p) => sum + p[d], 0) / clusterPoints.length
      );
    });
  }

  return { assignments, centroids };
}

/** Simple linear regression */
function linearRegression(
  xValues: number[],
  yValues: number[]
): { slope: number; intercept: number; rSquared: number; predictions: number[] } {
  const n = xValues.length;
  if (n < 2) return { slope: 0, intercept: 0, rSquared: 0, predictions: [] };

  const meanX = xValues.reduce((a, b) => a + b, 0) / n;
  const meanY = yValues.reduce((a, b) => a + b, 0) / n;

  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xValues[i] - meanX;
    const dy = yValues[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }

  const slope = denX === 0 ? 0 : num / denX;
  const intercept = meanY - slope * meanX;
  const rSquared = denX === 0 || denY === 0 ? 0 : (num * num) / (denX * denY);
  const predictions = xValues.map(x => slope * x + intercept);

  return { slope, intercept, rSquared, predictions };
}

/** Z-score normalization */
function zScoreNormalize(values: number[]): number[] {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const std = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
  return std === 0 ? values.map(() => 0) : values.map(v => (v - mean) / std);
}

// ============================================================
// Color Palette
// ============================================================

const COLORS = [
  'rgba(59, 130, 246, 0.8)',   // blue
  'rgba(16, 185, 129, 0.8)',   // emerald
  'rgba(245, 158, 11, 0.8)',   // amber
  'rgba(239, 68, 68, 0.8)',    // red
  'rgba(139, 92, 246, 0.8)',   // violet
  'rgba(236, 72, 153, 0.8)',   // pink
  'rgba(6, 182, 212, 0.8)',    // cyan
  'rgba(249, 115, 22, 0.8)',   // orange
];

const COLORS_BORDER = COLORS.map(c => c.replace('0.8', '1'));

// ============================================================
// Main Component
// ============================================================

function ReportPage() {
  // CSV state
  const [csvData, setCsvData] = useState<ParsedData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [fileName, setFileName] = useState<string>('');
  const [error, setError] = useState<string>('');

  // Column selections
  const [labelColumn, setLabelColumn] = useState<string>('');
  const [selectedNumericColumns, setSelectedNumericColumns] = useState<string[]>([]);
  const [selectedCategoricalColumns, setSelectedCategoricalColumns] = useState<string[]>([]);

  // Unified search state
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResponse, setSearchResponse] = useState<UnifiedSearchResponse | null>(null);
  const [searchError, setSearchError] = useState('');

  // ML state
  const [clusterCount, setClusterCount] = useState(3);
  const [clusterResults, setClusterResults] = useState<{ assignments: number[]; centroids: number[][] } | null>(null);
  const [regressionX, setRegressionX] = useState('');
  const [regressionY, setRegressionY] = useState('');
  const [regressionResult, setRegressionResult] = useState<RegressionResult | null>(null);

  // UI state
  const [activeTab, setActiveTab] = useState<'data' | 'search' | 'ml'>('data');
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    stats: true,
    charts: true,
    search: true,
    clustering: true,
    regression: true,
    decomposition: true,
    results: true,
  });

  const toggleSection = (key: string) => {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // ============================================================
  // CSV Upload & Parsing
  // ============================================================

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.csv')) {
      setError('Please upload a valid CSV file');
      event.target.value = '';
      return;
    }

    setError('');
    setFileName(file.name);
    setIsLoading(true);
    setClusterResults(null);
    setRegressionResult(null);

    Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.data && results.data.length > 0) {
          const headers = (results.meta.fields || []).map(h => h.trim());
          const rows = results.data.filter(
            (row) => Object.values(row as Record<string, unknown>).some((val) => val !== null && val !== '')
          ) as Record<string, string | number>[];

          setCsvData({ headers, rows });

          if (headers.length > 0) setLabelColumn(headers[0]);

          const numericCols = headers.filter(h => rows.length > 0 && typeof rows[0][h] === 'number');
          setSelectedNumericColumns(numericCols.slice(0, 3));

          const categoricalCols = headers.filter(h => rows.length > 0 && typeof rows[0][h] === 'string');
          setSelectedCategoricalColumns(categoricalCols.slice(0, 1));

          // Set default regression columns
          if (numericCols.length >= 2) {
            setRegressionX(numericCols[0]);
            setRegressionY(numericCols[1]);
          }

          setTimeout(() => setIsLoading(false), 400);
        } else {
          setError('CSV file is empty or invalid');
          setIsLoading(false);
        }
        event.target.value = '';
      },
      error: (parseError) => {
        setError(`Error parsing CSV: ${parseError.message}`);
        setIsLoading(false);
        event.target.value = '';
      },
    });
  };

  // ============================================================
  // Unified Search
  // ============================================================

  const handleUnifiedSearch = useCallback(async (query: string) => {
    if (!query.trim()) return;

    setIsSearching(true);
    setSearchError('');
    setSearchResponse(null);

    try {
      const res = await fetch('http://localhost:4000/api/unified-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          q: query.trim(),
          use_llm_filter: true,
          top_k: 20,
        }),
      });

      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data: UnifiedSearchResponse = await res.json();
      setSearchResponse(data);
    } catch (err: any) {
      setSearchError(err.message || 'Search failed');
    } finally {
      setIsSearching(false);
    }
  }, []);

  // ============================================================
  // Statistics Computations
  // ============================================================

  const columnTypes = useMemo(() => {
    if (!csvData || csvData.rows.length === 0) return { numeric: [], categorical: [] };
    const numeric: string[] = [];
    const categorical: string[] = [];
    csvData.headers.forEach(header => {
      if (typeof csvData.rows[0][header] === 'number') numeric.push(header);
      else categorical.push(header);
    });
    return { numeric, categorical };
  }, [csvData]);

  const calculateStats = (column: string): ColumnStats | null => {
    if (!csvData) return null;
    const values = csvData.rows.map(row => row[column]).filter(val => val !== null && val !== undefined && val !== '');
    const numericValues = values.map(val => Number(val)).filter(val => !isNaN(val));
    if (numericValues.length === 0) return null;

    const sorted = [...numericValues].sort((a, b) => a - b);
    const sum = numericValues.reduce((acc, val) => acc + val, 0);
    const avg = sum / numericValues.length;
    const median = sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)];
    const variance = numericValues.reduce((acc, val) => acc + (val - avg) ** 2, 0) / numericValues.length;
    const stdDev = Math.sqrt(variance);

    return {
      column,
      count: numericValues.length,
      missing: csvData.rows.length - values.length,
      sum, avg, median, stdDev,
      min: Math.min(...numericValues),
      max: Math.max(...numericValues),
      p25: sorted[Math.floor(sorted.length * 0.25)],
      p75: sorted[Math.floor(sorted.length * 0.75)],
    };
  };

  const calculateCategoricalStats = (column: string): CategoricalStats | null => {
    if (!csvData) return null;
    const values = csvData.rows.map(row => row[column]).filter(val => val !== null && val !== undefined && val !== '');
    const grouped = _.groupBy(values, v => String(v));
    const counts = Object.entries(grouped).map(([value, items]) => ({ value, count: items.length }));
    const topValues = _.orderBy(counts, 'count', 'desc').slice(0, 20);
    return { column, uniqueCount: Object.keys(grouped).length, topValues, missing: csvData.rows.length - values.length };
  };

  const calculateCorrelation = (col1: string, col2: string): number | null => {
    if (!csvData) return null;
    const pairs = csvData.rows.map(row => [Number(row[col1]), Number(row[col2])]).filter(([a, b]) => !isNaN(a) && !isNaN(b));
    if (pairs.length < 2) return null;
    const mean1 = pairs.reduce((s, [a]) => s + a, 0) / pairs.length;
    const mean2 = pairs.reduce((s, [, b]) => s + b, 0) / pairs.length;
    let num = 0, d1 = 0, d2 = 0;
    pairs.forEach(([a, b]) => { const dx = a - mean1, dy = b - mean2; num += dx * dy; d1 += dx * dx; d2 += dy * dy; });
    const den = Math.sqrt(d1 * d2);
    return den === 0 ? 0 : num / den;
  };

  // ============================================================
  // ML: Clustering
  // ============================================================

  const runClustering = useCallback(() => {
    if (!csvData || selectedNumericColumns.length < 2) return;

    const validRows = csvData.rows.filter(row =>
      selectedNumericColumns.every(col => {
        const v = Number(row[col]);
        return !isNaN(v);
      })
    );

    // Normalize each column independently
    const columns = selectedNumericColumns.map(col =>
      zScoreNormalize(validRows.map(row => Number(row[col])))
    );

    const dataPoints = validRows.map((_, i) => columns.map(col => col[i]));
    const result = kMeansClustering(dataPoints, clusterCount);
    setClusterResults(result);
  }, [csvData, selectedNumericColumns, clusterCount]);

  // ============================================================
  // ML: Linear Regression
  // ============================================================

  const runRegression = useCallback(() => {
    if (!csvData || !regressionX || !regressionY) return;

    const pairs = csvData.rows
      .map(row => ({ x: Number(row[regressionX]), y: Number(row[regressionY]) }))
      .filter(p => !isNaN(p.x) && !isNaN(p.y));

    if (pairs.length < 2) return;

    const xVals = pairs.map(p => p.x);
    const yVals = pairs.map(p => p.y);
    const result = linearRegression(xVals, yVals);

    setRegressionResult({
      ...result,
      xColumn: regressionX,
      yColumn: regressionY,
    });
  }, [csvData, regressionX, regressionY]);

  // ============================================================
  // Chart Generators
  // ============================================================

  const numericStats = useMemo(() =>
    selectedNumericColumns.map(col => calculateStats(col)).filter(Boolean) as ColumnStats[],
    [csvData, selectedNumericColumns]
  );

  const categoricalStats = useMemo(() =>
    selectedCategoricalColumns.map(col => calculateCategoricalStats(col)).filter(Boolean) as CategoricalStats[],
    [csvData, selectedCategoricalColumns]
  );

  const correlations = useMemo(() => {
    const corrs: Array<{ col1: string; col2: string; correlation: number }> = [];
    if (selectedNumericColumns.length >= 2) {
      for (let i = 0; i < selectedNumericColumns.length; i++) {
        for (let j = i + 1; j < selectedNumericColumns.length; j++) {
          const c = calculateCorrelation(selectedNumericColumns[i], selectedNumericColumns[j]);
          if (c !== null) corrs.push({ col1: selectedNumericColumns[i], col2: selectedNumericColumns[j], correlation: c });
        }
      }
    }
    return corrs;
  }, [csvData, selectedNumericColumns]);

  const generateLineChartData = () => {
    if (!csvData || selectedNumericColumns.length === 0 || !labelColumn) return null;
    const labels = csvData.rows.slice(0, 100).map(row => String(row[labelColumn] || ''));
    return {
      labels,
      datasets: selectedNumericColumns.map((col, i) => ({
        label: col,
        data: csvData.rows.slice(0, 100).map(row => Number(row[col]) || 0),
        borderColor: COLORS_BORDER[i % COLORS_BORDER.length],
        backgroundColor: COLORS[i % COLORS.length].replace('0.8', '0.15'),
        fill: true,
        tension: 0.3,
        pointRadius: labels.length > 50 ? 0 : 3,
      })),
    };
  };

  const generateBarChartData = () => {
    if (!csvData || selectedNumericColumns.length === 0 || !labelColumn) return null;
    const grouped = _.groupBy(csvData.rows, row => String(row[labelColumn] || 'Other'));
    const labels = Object.keys(grouped).slice(0, 30);
    return {
      labels,
      datasets: selectedNumericColumns.map((col, i) => ({
        label: col,
        data: labels.map(label => {
          const group = grouped[label];
          const vals = group.map(r => Number(r[col])).filter(v => !isNaN(v));
          return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
        }),
        backgroundColor: COLORS[i % COLORS.length],
        borderColor: COLORS_BORDER[i % COLORS_BORDER.length],
        borderWidth: 1,
      })),
    };
  };

  const generatePieChartData = () => {
    if (!csvData || selectedNumericColumns.length === 0) return null;
    const col = selectedNumericColumns[0];
    const grouped = _.groupBy(csvData.rows, row => String(row[labelColumn] || 'Other'));
    const entries = Object.entries(grouped)
      .map(([label, rows]) => ({
        label,
        total: rows.reduce((s, r) => s + (Number(r[col]) || 0), 0),
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    return {
      labels: entries.map(e => e.label),
      datasets: [{
        data: entries.map(e => Math.abs(e.total)),
        backgroundColor: entries.map((_, i) => COLORS[i % COLORS.length]),
        borderColor: entries.map((_, i) => COLORS_BORDER[i % COLORS_BORDER.length]),
        borderWidth: 1,
      }],
    };
  };

  const generateScatterData = () => {
    if (!csvData || !regressionResult) return null;

    const pairs = csvData.rows
      .map(row => ({ x: Number(row[regressionResult.xColumn]), y: Number(row[regressionResult.yColumn]) }))
      .filter(p => !isNaN(p.x) && !isNaN(p.y))
      .slice(0, 500);

    const sortedByX = [...pairs].sort((a, b) => a.x - b.x);
    const regressionLine = sortedByX.map(p => ({
      x: p.x,
      y: regressionResult.slope * p.x + regressionResult.intercept,
    }));

    return {
      datasets: [
        {
          label: 'Data Points',
          data: pairs,
          backgroundColor: 'rgba(59, 130, 246, 0.5)',
          pointRadius: 3,
          type: 'scatter' as const,
        },
        {
          label: `Regression (R² = ${regressionResult.rSquared.toFixed(3)})`,
          data: regressionLine,
          borderColor: 'rgba(239, 68, 68, 1)',
          backgroundColor: 'transparent',
          pointRadius: 0,
          type: 'line' as const,
          borderWidth: 2,
          showLine: true,
        },
      ],
    };
  };

  const generateClusterScatterData = () => {
    if (!csvData || !clusterResults || selectedNumericColumns.length < 2) return null;

    const col1 = selectedNumericColumns[0];
    const col2 = selectedNumericColumns[1];

    const validRows = csvData.rows.filter(row => {
      const v1 = Number(row[col1]), v2 = Number(row[col2]);
      return !isNaN(v1) && !isNaN(v2);
    }).slice(0, 500);

    // Group points by cluster
    const clusterDatasets = Array.from({ length: clusterCount }, (_, ci) => {
      const points = validRows
        .filter((_, i) => clusterResults.assignments[i] === ci)
        .map(row => ({ x: Number(row[col1]), y: Number(row[col2]) }));
      return {
        label: `Cluster ${ci + 1} (${points.length} pts)`,
        data: points,
        backgroundColor: COLORS[ci % COLORS.length],
        pointRadius: 4,
      };
    });

    return { datasets: clusterDatasets };
  };

  // ============================================================
  // Toggles
  // ============================================================

  const toggleNumericColumn = (column: string) => {
    setSelectedNumericColumns(prev =>
      prev.includes(column)
        ? prev.filter(c => c !== column)
        : [...prev, column]
    );
  };

  const toggleCategoricalColumn = (column: string) => {
    setSelectedCategoricalColumns(prev =>
      prev.includes(column)
        ? prev.filter(c => c !== column)
        : [...prev, column]
    );
  };

  // ============================================================
  // Chart data
  // ============================================================

  const lineData = useMemo(generateLineChartData, [csvData, selectedNumericColumns, labelColumn]);
  const barData = useMemo(generateBarChartData, [csvData, selectedNumericColumns, labelColumn]);
  const pieData = useMemo(generatePieChartData, [csvData, selectedNumericColumns, labelColumn]);
  const scatterData = useMemo(generateScatterData, [csvData, regressionResult]);
  const clusterScatterData = useMemo(generateClusterScatterData, [csvData, clusterResults, selectedNumericColumns, clusterCount]);

  // ============================================================
  // Sub-renders
  // ============================================================

  const renderSectionHeader = (title: string, key: string, icon: React.ReactNode) => (
    <button
      onClick={() => toggleSection(key)}
      className="w-full flex items-center justify-between py-3 text-left group"
    >
      <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
        {icon}
        {title}
      </h3>
      {expandedSections[key] ? (
        <ChevronUp className="w-5 h-5 text-gray-400 group-hover:text-gray-600" />
      ) : (
        <ChevronDown className="w-5 h-5 text-gray-400 group-hover:text-gray-600" />
      )}
    </button>
  );

  const renderPurposeBadge = (purpose: string) => {
    const badgeStyles: Record<string, string> = {
      primary: 'bg-blue-100 text-blue-700 border-blue-200',
      normalization: 'bg-green-100 text-green-700 border-green-200',
      filter: 'bg-amber-100 text-amber-700 border-amber-200',
      related: 'bg-purple-100 text-purple-700 border-purple-200',
    };
    return (
      <span className={`px-2 py-0.5 text-xs font-medium rounded-full border ${badgeStyles[purpose] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>
        {purpose}
      </span>
    );
  };

  const renderSearchResultCard = (item: UnifiedSearchResultItem, index: number) => (
    <div
      key={`${item.attr_id}-${index}`}
      className="bg-white border border-gray-200 rounded-lg p-4 hover:border-blue-300 hover:shadow-md transition-all duration-200"
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          <h5 className="font-semibold text-gray-800 text-sm truncate">{item.attr_desc}</h5>
          <p className="text-xs text-gray-500 mt-0.5 font-mono">{item.attr_orig}</p>
        </div>
        <div className="flex items-center gap-2 ml-3 flex-shrink-0">
          {renderPurposeBadge(item.search_purpose)}
        </div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 mt-2">
        <span>Dataset: <span className="font-medium text-gray-700">{item.dataset_clean}</span></span>
        <span>Entity: <span className="font-medium text-gray-700">{item.entity_type}</span></span>
        <span>Spatial: <span className="font-medium text-gray-700">{item.spatial_rep}</span></span>
      </div>

      <div className="flex items-center gap-3 mt-3">
        <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-blue-500 to-teal-500 rounded-full transition-all"
            style={{ width: `${(item.hybrid_score * 100).toFixed(0)}%` }}
          />
        </div>
        <span className="text-xs font-mono font-medium text-gray-600 w-14 text-right">
          {(item.hybrid_score * 100).toFixed(1)}%
        </span>
      </div>

      <div className="flex gap-2 mt-2 text-[10px]">
        <span className="text-gray-400">Semantic: {(item.semantic_score * 100).toFixed(0)}%</span>
        <span className="text-gray-400">Keyword: {(item.keyword_score * 100).toFixed(0)}%</span>
      </div>

      {item.tags && (
        <div className="flex flex-wrap gap-1 mt-2">
          {(() => {
            try {
              const parsed: string[] = JSON.parse(item.tags.replace(/'/g, '"'));
              return parsed.slice(0, 4).map((tag, ti) => (
                <span key={ti} className="px-1.5 py-0.5 bg-gray-100 text-gray-600 text-[10px] rounded">
                  {tag}
                </span>
              ));
            } catch {
              return null;
            }
          })()}
        </div>
      )}
    </div>
  );

  // ============================================================
  // Main Render
  // ============================================================

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-7xl mx-auto">

        {/* Page Header */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-1">
            Advanced Data Report & Search
          </h1>
          <p className="text-gray-500 text-sm">
            Upload CSV data for ML analysis, or search the geospatial catalog with unified semantic search.
          </p>

          {/* Tab Bar */}
          <div className="flex gap-1 mt-5 bg-gray-100 p-1 rounded-lg w-fit">
            {[
              { id: 'data' as const, label: 'CSV Analysis', icon: <Table className="w-4 h-4" /> },
              { id: 'search' as const, label: 'Unified Search', icon: <Search className="w-4 h-4" /> },
              { id: 'ml' as const, label: 'ML & Insights', icon: <Brain className="w-4 h-4" /> },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                  activeTab === tab.id
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* ============================================================
            TAB: CSV Analysis
            ============================================================ */}
        {activeTab === 'data' && (
          <div className="space-y-6">

            {/* Upload Area */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-400 transition-colors cursor-pointer">
                <label htmlFor="csv-upload" className="cursor-pointer flex flex-col items-center">
                  <Upload className="w-12 h-12 text-gray-400 mb-3" />
                  <span className="text-sm text-gray-600 mb-1">Click to upload CSV file</span>
                  <span className="text-xs text-gray-400">Supports any CSV with headers</span>
                  {fileName && (
                    <span className="mt-2 text-sm font-medium text-blue-600">{fileName}</span>
                  )}
                  <input
                    id="csv-upload"
                    type="file"
                    accept=".csv"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
              </div>
              {error && (
                <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  {error}
                </div>
              )}
            </div>

            {isLoading && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
                <Skeleton count={4} height={24} />
              </div>
            )}

            {/* Column Configuration */}
            {!isLoading && csvData && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <h3 className="text-lg font-semibold text-gray-800 mb-4">Configure Columns</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Label Column (X-axis)</label>
                    <select
                      value={labelColumn}
                      onChange={(e) => setLabelColumn(e.target.value)}
                      className="w-full p-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-300 focus:border-blue-400 outline-none"
                    >
                      {csvData.headers.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Numeric Columns</label>
                    <div className="flex flex-wrap gap-2">
                      {columnTypes.numeric.map(col => (
                        <button
                          key={col}
                          onClick={() => toggleNumericColumn(col)}
                          className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${
                            selectedNumericColumns.includes(col)
                              ? 'bg-blue-100 text-blue-700 border-blue-300'
                              : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                          }`}
                        >
                          {col}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Categorical Columns</label>
                    <div className="flex flex-wrap gap-2">
                      {columnTypes.categorical.map(col => (
                        <button
                          key={col}
                          onClick={() => toggleCategoricalColumn(col)}
                          className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${
                            selectedCategoricalColumns.includes(col)
                              ? 'bg-green-100 text-green-700 border-green-300'
                              : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                          }`}
                        >
                          {col}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Statistics */}
            {!isLoading && csvData && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                {renderSectionHeader('Statistical Summary', 'stats', <BarChart3 className="w-5 h-5 text-blue-600" />)}
                {expandedSections.stats && (
                  <div className="space-y-4 mt-2">
                    {/* Overview */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                      <div className="bg-blue-50 rounded-lg p-3 text-center">
                        <div className="text-2xl font-bold text-blue-700">{csvData.rows.length}</div>
                        <div className="text-xs text-blue-500">Rows</div>
                      </div>
                      <div className="bg-green-50 rounded-lg p-3 text-center">
                        <div className="text-2xl font-bold text-green-700">{csvData.headers.length}</div>
                        <div className="text-xs text-green-500">Columns</div>
                      </div>
                      <div className="bg-amber-50 rounded-lg p-3 text-center">
                        <div className="text-2xl font-bold text-amber-700">{columnTypes.numeric.length}</div>
                        <div className="text-xs text-amber-500">Numeric</div>
                      </div>
                      <div className="bg-purple-50 rounded-lg p-3 text-center">
                        <div className="text-2xl font-bold text-purple-700">{columnTypes.categorical.length}</div>
                        <div className="text-xs text-purple-500">Categorical</div>
                      </div>
                    </div>

                    {/* Numeric Stats Table */}
                    {numericStats.length > 0 && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-gray-200">
                              <th className="text-left py-2 px-3 text-gray-600 font-medium">Column</th>
                              <th className="text-right py-2 px-3 text-gray-600 font-medium">Count</th>
                              <th className="text-right py-2 px-3 text-gray-600 font-medium">Mean</th>
                              <th className="text-right py-2 px-3 text-gray-600 font-medium">Std Dev</th>
                              <th className="text-right py-2 px-3 text-gray-600 font-medium">Min</th>
                              <th className="text-right py-2 px-3 text-gray-600 font-medium">P25</th>
                              <th className="text-right py-2 px-3 text-gray-600 font-medium">Median</th>
                              <th className="text-right py-2 px-3 text-gray-600 font-medium">P75</th>
                              <th className="text-right py-2 px-3 text-gray-600 font-medium">Max</th>
                            </tr>
                          </thead>
                          <tbody>
                            {numericStats.map(stat => (
                              <tr key={stat.column} className="border-b border-gray-100 hover:bg-gray-50">
                                <td className="py-2 px-3 font-medium text-gray-800">{stat.column}</td>
                                <td className="text-right py-2 px-3">{stat.count}</td>
                                <td className="text-right py-2 px-3">{stat.avg.toFixed(2)}</td>
                                <td className="text-right py-2 px-3">{stat.stdDev.toFixed(2)}</td>
                                <td className="text-right py-2 px-3">{stat.min.toFixed(2)}</td>
                                <td className="text-right py-2 px-3">{stat.p25.toFixed(2)}</td>
                                <td className="text-right py-2 px-3">{stat.median.toFixed(2)}</td>
                                <td className="text-right py-2 px-3">{stat.p75.toFixed(2)}</td>
                                <td className="text-right py-2 px-3">{stat.max.toFixed(2)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Correlations */}
                    {correlations.length > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold text-gray-700 mb-2">Correlation Matrix</h4>
                        <div className="space-y-1">
                          {correlations.map((corr, idx) => (
                            <div key={idx} className="flex items-center justify-between text-sm bg-gray-50 rounded px-3 py-1.5">
                              <span className="text-gray-700">{corr.col1} ↔ {corr.col2}</span>
                              <span className={`font-mono font-medium ${
                                Math.abs(corr.correlation) > 0.7 ? 'text-red-600' :
                                Math.abs(corr.correlation) > 0.4 ? 'text-amber-600' : 'text-gray-500'
                              }`}>
                                r = {corr.correlation.toFixed(3)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Categorical Stats */}
                    {categoricalStats.length > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold text-gray-700 mb-2">Categorical Summary</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {categoricalStats.map(stat => (
                            <div key={stat.column} className="bg-gray-50 rounded-lg p-3">
                              <div className="font-medium text-gray-800 text-sm mb-1">{stat.column}</div>
                              <div className="text-xs text-gray-500 mb-2">
                                {stat.uniqueCount} unique · {stat.missing} missing
                              </div>
                              {stat.topValues.slice(0, 5).map((v, i) => (
                                <div key={i} className="flex items-center justify-between text-xs py-0.5">
                                  <span className="text-gray-600 truncate max-w-[70%]">{v.value}</span>
                                  <span className="text-gray-400">{v.count}</span>
                                </div>
                              ))}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Charts */}
            {!isLoading && csvData && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                {renderSectionHeader('Visualizations', 'charts', <TrendingUp className="w-5 h-5 text-green-600" />)}
                {expandedSections.charts && (
                  <div className="space-y-6 mt-2">
                    {lineData && (
                      <div>
                        <h4 className="text-sm font-semibold text-gray-700 mb-3">Line Chart</h4>
                        <Line data={lineData} options={{
                          responsive: true,
                          plugins: { legend: { position: 'top' } },
                          scales: { y: { beginAtZero: true } },
                        }} />
                      </div>
                    )}
                    {barData && (
                      <div>
                        <h4 className="text-sm font-semibold text-gray-700 mb-3">Bar Chart (Aggregated)</h4>
                        <Bar data={barData} options={{
                          responsive: true,
                          plugins: { legend: { position: 'top' } },
                          scales: { y: { beginAtZero: true } },
                        }} />
                      </div>
                    )}
                    {pieData && (
                      <div className="max-w-md mx-auto">
                        <h4 className="text-sm font-semibold text-gray-700 mb-3">Distribution</h4>
                        <Pie data={pieData} options={{
                          responsive: true,
                          plugins: { legend: { position: 'bottom' } },
                        }} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {!isLoading && !csvData && (
              <div className="text-center py-16 text-gray-400">
                <Upload className="w-16 h-16 mx-auto mb-4 opacity-30" />
                <p>Upload a CSV file to begin analysis</p>
              </div>
            )}
          </div>
        )}

        {/* ============================================================
            TAB: Unified Search
            ============================================================ */}
        {activeTab === 'search' && (
          <div className="space-y-6">

            {/* Search Bar */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <div className="flex items-center gap-2 mb-4">
                <Database className="w-5 h-5 text-blue-600" />
                <h3 className="text-lg font-semibold text-gray-800">Geospatial Catalog Search</h3>
              </div>
              <p className="text-sm text-gray-500 mb-4">
                Uses AI-powered query decomposition + semantic/keyword hybrid search + LLM verification.
              </p>

              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleUnifiedSearch(searchQuery)}
                    placeholder="e.g. unemployment, education levels, and median income for rural areas"
                    className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-300 focus:border-blue-400 outline-none"
                    disabled={isSearching}
                  />
                </div>
                <button
                  onClick={() => handleUnifiedSearch(searchQuery)}
                  disabled={isSearching || !searchQuery.trim()}
                  className="px-6 py-3 bg-gradient-to-r from-blue-600 to-teal-600 text-white rounded-lg text-sm font-medium hover:from-blue-700 hover:to-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2"
                >
                  {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  Search
                </button>
              </div>

              {/* Quick examples */}
              <div className="flex flex-wrap gap-2 mt-3">
                {[
                  'poverty rates per capita by county',
                  'cancer rates and healthcare access',
                  'environmental pollution near waterways',
                  'housing affordability and income',
                ].map((example, i) => (
                  <button
                    key={i}
                    onClick={() => { setSearchQuery(example); handleUnifiedSearch(example); }}
                    className="px-2.5 py-1 text-xs bg-gray-100 text-gray-600 rounded-full hover:bg-gray-200 transition-colors"
                    disabled={isSearching}
                  >
                    {example}
                  </button>
                ))}
              </div>

              {searchError && (
                <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  {searchError}
                </div>
              )}
            </div>

            {isSearching && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
                <Loader2 className="w-8 h-8 text-blue-500 animate-spin mx-auto mb-3" />
                <p className="text-gray-500 text-sm">Running unified search pipeline...</p>
                <p className="text-gray-400 text-xs mt-1">Decomposing → Searching → Verifying with LLM</p>
              </div>
            )}

            {/* Search Results */}
            {searchResponse && !isSearching && (
              <>
                {/* Decomposition */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                  {renderSectionHeader('Query Decomposition', 'decomposition', <GitBranch className="w-5 h-5 text-purple-600" />)}
                  {expandedSections.decomposition && (
                    <div className="mt-2 space-y-3">
                      <div className="bg-gray-50 rounded-lg p-4">
                        <div className="text-sm text-gray-600 mb-3">
                          Your query "<span className="font-medium text-gray-800">{searchResponse.query}</span>" was decomposed into:
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          <div>
                            <div className="text-xs font-medium text-blue-600 uppercase tracking-wide mb-1">Primary Concepts</div>
                            <div className="flex flex-wrap gap-1">
                              {searchResponse.decomposition.primary_concepts.map((c, i) => (
                                <span key={i} className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs">{c}</span>
                              ))}
                            </div>
                          </div>
                          <div>
                            <div className="text-xs font-medium text-green-600 uppercase tracking-wide mb-1">Normalization</div>
                            <div className="flex flex-wrap gap-1">
                              {searchResponse.decomposition.normalization_concepts.length > 0
                                ? searchResponse.decomposition.normalization_concepts.map((c, i) => (
                                    <span key={i} className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs">{c}</span>
                                  ))
                                : <span className="text-xs text-gray-400">None</span>
                              }
                            </div>
                          </div>
                          <div>
                            <div className="text-xs font-medium text-amber-600 uppercase tracking-wide mb-1">Filters</div>
                            <div className="flex flex-wrap gap-1">
                              {searchResponse.decomposition.filter_concepts.length > 0
                                ? searchResponse.decomposition.filter_concepts.map((c, i) => (
                                    <span key={i} className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded text-xs">{c}</span>
                                  ))
                                : <span className="text-xs text-gray-400">None</span>
                              }
                            </div>
                          </div>
                        </div>
                        <div className="mt-3 pt-3 border-t border-gray-200">
                          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Search Queries Generated</div>
                          <div className="space-y-1">
                            {searchResponse.decomposition.search_queries.map((sq, i) => (
                              <div key={i} className="flex items-center gap-2 text-xs">
                                <span className="font-mono bg-gray-200 px-2 py-0.5 rounded text-gray-700">{sq.query}</span>
                                {renderPurposeBadge(sq.purpose)}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Stats bar */}
                      <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
                        <span className="flex items-center gap-1">
                          <Activity className="w-3 h-3" />
                          {searchResponse.stats.total_results} results
                        </span>
                        <span>Primary: {searchResponse.stats.primary_count}</span>
                        <span>Normalization: {searchResponse.stats.normalization_count}</span>
                        <span>Filter: {searchResponse.stats.filter_count}</span>
                        <span>{searchResponse.stats.processing_time_ms}ms</span>
                        {searchResponse.stats.llm_filtered && (
                          <span className="px-1.5 py-0.5 bg-purple-100 text-purple-600 rounded text-[10px]">LLM Verified</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Results by Purpose */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                  {renderSectionHeader(`Results (${searchResponse.all_results.length})`, 'results', <Database className="w-5 h-5 text-blue-600" />)}
                  {expandedSections.results && (
                    <div className="mt-2 space-y-6">
                      {/* Results by Query */}
                      {searchResponse.results_by_query.map((rq, qi) => (
                        <div key={qi}>
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-sm font-semibold text-gray-700">"{rq.query}"</span>
                            {renderPurposeBadge(rq.purpose)}
                            <span className="text-xs text-gray-400">({rq.results.length} results)</span>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {rq.results.map((item, i) => renderSearchResultCard(item, i))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}

            {!searchResponse && !isSearching && (
              <div className="text-center py-16 text-gray-400">
                <Search className="w-16 h-16 mx-auto mb-4 opacity-30" />
                <p>Enter a query to search the geospatial data catalog</p>
              </div>
            )}
          </div>
        )}

        {/* ============================================================
            TAB: ML & Insights
            ============================================================ */}
        {activeTab === 'ml' && (
          <div className="space-y-6">

            {!csvData && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
                <Brain className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-700 mb-2">Upload Data First</h3>
                <p className="text-gray-400 text-sm mb-4">
                  Switch to the CSV Analysis tab and upload a dataset to unlock ML features.
                </p>
                <button
                  onClick={() => setActiveTab('data')}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                >
                  Go to CSV Upload
                </button>
              </div>
            )}

            {csvData && (
              <>
                {/* K-Means Clustering */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                  {renderSectionHeader('K-Means Clustering', 'clustering', <Brain className="w-5 h-5 text-violet-600" />)}
                  {expandedSections.clustering && (
                    <div className="mt-2 space-y-4">
                      <p className="text-sm text-gray-500">
                        Group your data into clusters based on selected numeric columns. Uses Z-score normalization before clustering.
                      </p>

                      <div className="flex flex-wrap items-end gap-4">
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Number of Clusters (K)</label>
                          <select
                            value={clusterCount}
                            onChange={(e) => setClusterCount(Number(e.target.value))}
                            className="p-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-violet-300 outline-none"
                          >
                            {[2, 3, 4, 5, 6, 7, 8].map(k => (
                              <option key={k} value={k}>{k} clusters</option>
                            ))}
                          </select>
                        </div>
                        <div className="text-xs text-gray-500">
                          Using columns: {selectedNumericColumns.join(', ') || 'Select numeric columns in CSV tab'}
                        </div>
                        <button
                          onClick={runClustering}
                          disabled={selectedNumericColumns.length < 2}
                          className="px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          Run Clustering
                        </button>
                      </div>

                      {selectedNumericColumns.length < 2 && (
                        <p className="text-xs text-amber-600">
                          Select at least 2 numeric columns in the CSV Analysis tab to enable clustering.
                        </p>
                      )}

                      {clusterResults && clusterScatterData && (
                        <div>
                          <h4 className="text-sm font-semibold text-gray-700 mb-2">
                            Cluster Visualization ({selectedNumericColumns[0]} vs {selectedNumericColumns[1]})
                          </h4>
                          <Scatter
                            data={clusterScatterData}
                            options={{
                              responsive: true,
                              plugins: { legend: { position: 'top' } },
                              scales: {
                                x: { title: { display: true, text: selectedNumericColumns[0] } },
                                y: { title: { display: true, text: selectedNumericColumns[1] } },
                              },
                            }}
                          />
                          <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                            {Array.from({ length: clusterCount }, (_, ci) => {
                              const size = clusterResults.assignments.filter(a => a === ci).length;
                              return (
                                <div key={ci} className="bg-gray-50 rounded p-2 text-center">
                                  <div className="w-3 h-3 rounded-full mx-auto mb-1" style={{ backgroundColor: COLORS[ci % COLORS.length] }} />
                                  <div className="font-medium">Cluster {ci + 1}</div>
                                  <div className="text-gray-500">{size} points</div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Linear Regression */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                  {renderSectionHeader('Linear Regression', 'regression', <TrendingUp className="w-5 h-5 text-red-600" />)}
                  {expandedSections.regression && (
                    <div className="mt-2 space-y-4">
                      <p className="text-sm text-gray-500">
                        Fit a linear model (y = mx + b) between two numeric columns and see the R² goodness-of-fit.
                      </p>

                      <div className="flex flex-wrap items-end gap-4">
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">X (Independent)</label>
                          <select
                            value={regressionX}
                            onChange={(e) => setRegressionX(e.target.value)}
                            className="p-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-300 outline-none"
                          >
                            <option value="">Select column</option>
                            {columnTypes.numeric.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Y (Dependent)</label>
                          <select
                            value={regressionY}
                            onChange={(e) => setRegressionY(e.target.value)}
                            className="p-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-300 outline-none"
                          >
                            <option value="">Select column</option>
                            {columnTypes.numeric.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </div>
                        <button
                          onClick={runRegression}
                          disabled={!regressionX || !regressionY}
                          className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          Run Regression
                        </button>
                      </div>

                      {regressionResult && (
                        <div className="space-y-4">
                          <div className="grid grid-cols-3 gap-3 text-sm">
                            <div className="bg-red-50 rounded-lg p-3 text-center">
                              <div className="text-xl font-bold text-red-700">
                                {regressionResult.rSquared.toFixed(4)}
                              </div>
                              <div className="text-xs text-red-500">R² Score</div>
                            </div>
                            <div className="bg-gray-50 rounded-lg p-3 text-center">
                              <div className="text-xl font-bold text-gray-700">
                                {regressionResult.slope.toFixed(4)}
                              </div>
                              <div className="text-xs text-gray-500">Slope (m)</div>
                            </div>
                            <div className="bg-gray-50 rounded-lg p-3 text-center">
                              <div className="text-xl font-bold text-gray-700">
                                {regressionResult.intercept.toFixed(4)}
                              </div>
                              <div className="text-xs text-gray-500">Intercept (b)</div>
                            </div>
                          </div>
                          <div className="text-xs text-gray-500 bg-gray-50 rounded p-2 font-mono">
                            {regressionResult.yColumn} = {regressionResult.slope.toFixed(4)} × {regressionResult.xColumn} + {regressionResult.intercept.toFixed(4)}
                          </div>
                          {scatterData && (
                            <Scatter
                              data={scatterData as any}
                              options={{
                                responsive: true,
                                plugins: { legend: { position: 'top' } },
                                scales: {
                                  x: { title: { display: true, text: regressionResult.xColumn } },
                                  y: { title: { display: true, text: regressionResult.yColumn } },
                                },
                              }}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Anomaly Detection (Z-Score based) */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                  {renderSectionHeader('Outlier Detection', 'anomalies', <AlertCircle className="w-5 h-5 text-amber-600" />)}
                  {expandedSections.anomalies !== false && selectedNumericColumns.length > 0 && (
                    <div className="mt-2 space-y-3">
                      <p className="text-sm text-gray-500">
                        Rows with Z-score &gt; 2.5 in any selected numeric column (potential outliers).
                      </p>
                      {selectedNumericColumns.map(col => {
                        const stat = calculateStats(col);
                        if (!stat || stat.stdDev === 0) return null;
                        const threshold = 2.5;
                        const outliers = csvData.rows
                          .map((row, idx) => ({ row, idx, value: Number(row[col]), z: Math.abs((Number(row[col]) - stat.avg) / stat.stdDev) }))
                          .filter(o => !isNaN(o.z) && o.z > threshold)
                          .sort((a, b) => b.z - a.z)
                          .slice(0, 10);

                        if (outliers.length === 0) return null;
                        return (
                          <div key={col} className="bg-amber-50 rounded-lg p-3">
                            <div className="text-sm font-medium text-amber-800 mb-1">{col} — {outliers.length} outlier(s)</div>
                            <div className="space-y-1 text-xs">
                              {outliers.map((o, i) => (
                                <div key={i} className="flex justify-between text-amber-700">
                                  <span>Row {o.idx + 1}: {o.value.toFixed(2)}</span>
                                  <span className="font-mono">z = {o.z.toFixed(2)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

      </div>
    </div>
  );
}

export default ReportPage;