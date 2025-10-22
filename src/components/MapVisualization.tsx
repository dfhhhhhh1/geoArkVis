// MapVisualization.tsx
import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Rectangle, useMap, GeoJSON } from 'react-leaflet';
import { ZoomIn, ZoomOut, Layers, Move3D } from 'lucide-react';
import Papa from 'papaparse';
import 'leaflet/dist/leaflet.css';

// Fix for default marker icon issue with Webpack
interface Dataset {
  id: string;
  title: string;
  description: string;
  source: string;
  downloadUrl?: string;
  coordinates: {
    lat: number;
    lng: number;
  };
  boundingBox?: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
  coverage: {
    geographic: string;
    temporal: string;
  };
}

interface MapVisualizationProps {
  datasets: Dataset[];
}

// Custom component to handle map interactions like zoom
const MapController: React.FC<{ zoomLevel: number }> = ({ zoomLevel }) => {
  const map = useMap();
  useEffect(() => {
    map.setZoom(zoomLevel);
  }, [zoomLevel, map]);
  return null;
};

const MapVisualization: React.FC<MapVisualizationProps> = ({ datasets }) => {
  const [zoomLevel, setZoomLevel] = useState(3);
  const [showLayers, setShowLayers] = useState(true);
  const [countyData, setCountyData] = useState<any>(null);
  const [csvData, setCsvData] = useState<any[]>([]);
  const [selectedMetric, setSelectedMetric] = useState<string>('');
  const [availableMetrics, setAvailableMetrics] = useState<string[]>([]);

  // Load GeoJSON
  useEffect(() => {
    fetch('/counties.geojson')
      .then(response => response.json())
      .then(data => {
        setCountyData(data);
      })
      .catch(error => console.error("Failed to load GeoJSON data:", error));
  }, []);

  // Load and parse CSV
  useEffect(() => {
    fetch('/usa_county.csv') // Replace with your CSV file path
      .then(response => response.text())
      .then(csvText => {
        Papa.parse(csvText, {
          header: true,
          dynamicTyping: true,
          skipEmptyLines: true,
          complete: (results) => {
            setCsvData(results.data);
            // Get available metrics (all columns except FIPS)
            if (results.data.length > 0) {
              const metrics = Object.keys(results.data[0]).filter(
                key => key.toLowerCase() !== 'fips'
              );
              setAvailableMetrics(metrics);
              if (metrics.length > 0) setSelectedMetric(metrics[0]);
            }
          },
          error: (error) => console.error("Failed to parse CSV:", error)
        });
      })
      .catch(error => console.error("Failed to load CSV:", error));
  }, []);

  const centerLat = datasets.length > 0
    ? datasets.reduce((sum, d) => sum + d.coordinates.lat, 0) / datasets.length
    : 39.8283;
  const centerLng = datasets.length > 0
    ? datasets.reduce((sum, d) => sum + d.coordinates.lng, 0) / datasets.length
    : -98.5795;

  // Create a lookup map from CSV data by FIPS code
  const dataByFips = React.useMemo(() => {
    const map = new Map();
    csvData.forEach(row => {
      const fips = String(row.FIPS || row.fips || '').padStart(5, '0');
      if (fips) map.set(fips, row);
    });
    return map;
  }, [csvData]);

  // Get min and max values for the selected metric
  const { min, max } = React.useMemo(() => {
    if (!selectedMetric || csvData.length === 0) return { min: 0, max: 1 };
    
    const values = csvData
      .map(row => row[selectedMetric])
      .filter(val => typeof val === 'number' && !isNaN(val));
    
    return {
      min: Math.min(...values),
      max: Math.max(...values)
    };
  }, [csvData, selectedMetric]);

  // Color scale function
  const getColor = (value: number) => {
    if (value === undefined || value === null || isNaN(value)) return '#e0e0e0';
    
    const normalized = (value - min) / (max - min);
    
    // Color gradient from light blue to dark blue
    const colors = [
      '#f0f9ff', // lightest
      '#bae6fd',
      '#7dd3fc',
      '#38bdf8',
      '#0ea5e9',
      '#0284c7',
      '#0369a1',
      '#075985'  // darkest
    ];
    
    const index = Math.min(Math.floor(normalized * colors.length), colors.length - 1);
    return colors[index];
  };

  // Style function for GeoJSON
  const getFeatureStyle = (feature: any) => {
    const fips = String(feature.properties.GEOID || feature.properties.FIPS || '').padStart(5, '0');
    const rowData = dataByFips.get(fips);
    const value = rowData ? rowData[selectedMetric] : undefined;
    
    return {
      fillColor: getColor(value),
      weight: 0.2,
      opacity: 1,
      color: '#666',
      fillOpacity: 0.7,
    };
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-lg">
      {/* Map Header */}
      <div className="p-4 border-b border-slate-200 bg-slate-50">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <h3 className="font-semibold text-slate-800">Data Coverage Map</h3>
            {availableMetrics.length > 0 && (
              <select
                value={selectedMetric}
                onChange={(e) => setSelectedMetric(e.target.value)}
                className="text-sm border border-slate-300 rounded-lg px-3 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {availableMetrics.map(metric => (
                  <option key={metric} value={metric}>{metric}</option>
                ))}
              </select>
            )}
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setZoomLevel(Math.max(1, zoomLevel - 1))}
              className="p-1.5 text-slate-600 hover:text-slate-800 hover:bg-white rounded-lg transition-colors"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <span className="text-sm text-slate-500 px-2">
              Zoom {zoomLevel}x
            </span>
            <button
              onClick={() => setZoomLevel(Math.min(10, zoomLevel + 1))}
              className="p-1.5 text-slate-600 hover:text-slate-800 hover:bg-white rounded-lg transition-colors"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <div className="w-px h-4 bg-slate-300" />
            <button
              onClick={() => setShowLayers(!showLayers)}
              className={`p-1.5 rounded-lg transition-colors ${
                showLayers
                  ? 'text-blue-600 bg-blue-50'
                  : 'text-slate-600 hover:text-slate-800 hover:bg-white'
              }`}
            >
              <Layers className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
      
      {/* Map Display using Leaflet */}
      <div className="relative h-80">
        <MapContainer
          center={[centerLat, centerLng]}
          zoom={zoomLevel}
          scrollWheelZoom={true}
          className="h-full w-full z-0"
        >
          <MapController zoomLevel={zoomLevel} />
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          
          {/* Use the GeoJSON component to render the county shapes */}
          {countyData && (
            <GeoJSON
              key={selectedMetric} // Re-render when metric changes
              data={countyData}
              style={getFeatureStyle}
              onEachFeature={(feature, layer) => {
                const fips = String(feature.properties.GEOID || feature.properties.FIPS || '').padStart(5, '0');
                const rowData = dataByFips.get(fips);
                const value = rowData ? rowData[selectedMetric] : 'No data';
                
                const countyName = feature.properties.NAME || 'Unknown';
                
                layer.bindPopup(`
                  <div>
                    <h3 class="font-semibold">${countyName} County</h3>
                    <p class="text-sm"><strong>${selectedMetric}:</strong> ${typeof value === 'number' ? value.toLocaleString() : value}</p>
                    ${fips ? `<p class="text-xs text-gray-500">FIPS: ${fips}</p>` : ''}
                  </div>
                `);
              }}
            />
          )}

          {/* Dataset markers and rectangles */}
          {datasets.map((dataset) => (
            <React.Fragment key={dataset.id}>
              {/* Marker for dataset coordinates */}
              <Marker position={[dataset.coordinates.lat, dataset.coordinates.lng]}>
                <Popup>
                  <h4 className="font-semibold text-slate-800">{dataset.title}</h4>
                  <p className="text-sm text-slate-600">{dataset.description}</p>
                  <p className="text-xs text-slate-500 mt-1">Source: {dataset.source}</p>
                  {dataset.downloadUrl && (
                    <a href={dataset.downloadUrl} className="text-blue-500 hover:underline text-xs mt-1 block">Download</a>
                  )}
                </Popup>
              </Marker>
              {/* Bounding box for dataset coverage */}
              {dataset.boundingBox && (
                <Rectangle
                  bounds={[
                    [dataset.boundingBox.south, dataset.boundingBox.west],
                    [dataset.boundingBox.north, dataset.boundingBox.east],
                  ]}
                  pathOptions={{ color: 'blue', weight: 2, opacity: 0.5, fillOpacity: 0.1 }}
                >
                  <Popup>
                    <h5 className="font-semibold text-slate-800">Coverage Area: {dataset.title}</h5>
                    <p className="text-sm text-slate-600">Geographic: {dataset.coverage.geographic}</p>
                    <p className="text-sm text-slate-600">Temporal: {dataset.coverage.temporal}</p>
                  </Popup>
                </Rectangle>
              )}
            </React.Fragment>
          ))}
        </MapContainer>
        
        {/* Interactive Controls Overlay */}
        <div className="absolute top-4 right-4 z-10">
          <div className="bg-white rounded-lg shadow-lg p-2 space-y-1">
            <button className="w-8 h-8 flex items-center justify-center text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded transition-colors">
              <Move3D className="w-4 h-4" />
            </button>
          </div>
        </div>
        
        {/* Legend */}
        {showLayers && (
          <div className="absolute bottom-4 left-4 bg-white rounded-lg shadow-lg p-3 text-xs z-10">
            <div className="font-medium text-slate-800 mb-2">Legend</div>
            <div className="space-y-2">
              {selectedMetric && csvData.length > 0 && (
                <div className="mb-3">
                  <div className="text-slate-600 font-medium mb-1">{selectedMetric}</div>
                  <div className="flex items-center space-x-1">
                    <span className="text-slate-500">{min.toLocaleString()}</span>
                    <div className="flex-1 h-4 rounded" style={{
                      background: 'linear-gradient(to right, #f0f9ff, #bae6fd, #7dd3fc, #38bdf8, #0ea5e9, #0284c7, #0369a1, #075985)'
                    }}></div>
                    <span className="text-slate-500">{max.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center space-x-2 mt-1">
                    <div className="w-3 h-3 bg-gray-300 rounded"></div>
                    <span className="text-slate-600">No data</span>
                  </div>
                </div>
              )}
              <div className="flex items-center space-x-2">
                <div className="w-3 h-3 bg-blue-600 rounded-full"></div>
                <span className="text-slate-600">Dataset Location</span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="w-3 h-3 border-2 border-blue-600 bg-blue-400 opacity-50"></div>
                <span className="text-slate-600">Coverage Area (Bounding Box)</span>
              </div>
            </div>
          </div>
        )}
      </div>
      
      {/* Map Footer */}
      <div className="p-3 bg-slate-50 text-xs text-slate-500 border-t border-slate-200">
        <div className="flex items-center justify-between">
          <span>Showing {datasets.length} dataset{datasets.length !== 1 ? 's' : ''}</span>
          <span>Interactive map • Click and drag to explore</span>
        </div>
      </div>
    </div>
  );
};

export default MapVisualization;