// MapVisualization.tsx
import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Rectangle, useMap } from 'react-leaflet';
import { ZoomIn, ZoomOut, Layers, Move3D } from 'lucide-react';
import { Dataset } from '../types';
import 'leaflet/dist/leaflet.css';
import { GeoJSON } from 'react-leaflet'; // Import GeoJSON component
// Fix for default marker icon issue with Webpack

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
  const [countyData, setCountyData] = useState<any>(null); // State to hold GeoJSON data

  useEffect(() => {
    // Fetch the GeoJSON data from the public folder
    fetch('/counties.geojson')
      .then(response => response.json())
      .then(data => {
        setCountyData(data);
      })
      .catch(error => console.error("Failed to load GeoJSON data:", error));
  }, []); // Empty dependency array to run only once on component mount

  // ... (rest of your component)
  const centerLat = datasets.length > 0
    ? datasets.reduce((sum, d) => sum + d.coordinates.lat, 0) / datasets.length
    : 39.8283;
  const centerLng = datasets.length > 0
    ? datasets.reduce((sum, d) => sum + d.coordinates.lng, 0) / datasets.length
    : -98.5795;

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-lg">
      {/* Map Header */}
      <div className="p-4 border-b border-slate-200 bg-slate-50">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-800">Data Coverage Map</h3>
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
              data={countyData}
              style={(feature) => ({
                fillColor: 'transparent',
                weight: 1,
                opacity: 1,
                color: 'grey',
                dashArray: '3',
                fillOpacity: 0.1,
              })}
              onEachFeature={(feature, layer) => {
                // Example of how to add a popup for each county
                if (feature.properties && feature.properties.NAME) {
                  layer.bindPopup(`<h3>${feature.properties.NAME} County</h3>`);
                }
              }}
            />
          )}

          {/* ... (rest of your markers and rectangles) */}
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
        {/* Interactive Controls Overlay - Keep your existing buttons */}
        <div className="absolute top-4 right-4 z-10"> {/* z-10 to keep controls above the map */}
          <div className="bg-white rounded-lg shadow-lg p-2 space-y-1">
            <button className="w-8 h-8 flex items-center justify-center text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded transition-colors">
              <Move3D className="w-4 h-4" />
            </button>
          </div>
        </div>
        {/* Legend */}
        {showLayers && (
          <div className="absolute bottom-4 left-4 bg-white rounded-lg shadow-lg p-3 text-xs z-10"> {/* z-10 for legend */}
            <div className="font-medium text-slate-800 mb-2">Legend</div>
            <div className="space-y-1">
              <div className="flex items-center space-x-2">
                <div className="w-3 h-3 bg-blue-600 rounded-full"></div>
                <span className="text-slate-600">Dataset Location</span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="w-3 h-3 border-2 border-blue-600 bg-blue-400 opacity-50"></div>
                <span className="text-slate-600">Coverage Area (Bounding Box)</span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="w-3 h-3 border border-gray-500"></div>
                <span className="text-slate-600">County Boundaries</span>
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