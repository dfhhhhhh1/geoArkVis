import React, { useState } from 'react';
import Header from './components/Header';
import SearchBar from './components/SearchBar';
import SearchResults from './components/SearchResults';
import MapVisualization from './components/MapVisualization';
import DatasetModal from './components/DatasetModal';
import { Dataset, CartItem } from './types';
// import { mockDatasets } from './data/mockData';

function App() {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Dataset[]>([]);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [selectedDataset, setSelectedDataset] = useState<Dataset | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSearch = async (query: string) => {
    setIsLoading(true);
    setSearchQuery(query);
    
    // Simulate API call with mock data filtering
  //     setTimeout(() => {
  //     const filtered = mockDatasets.filter(dataset => 
  //       dataset.title.toLowerCase().includes(query.toLowerCase()) ||
  //       dataset.description.toLowerCase().includes(query.toLowerCase()) ||
  //       dataset.tags.some(tag => tag.toLowerCase().includes(query.toLowerCase()))
  //     );
  //     setSearchResults(filtered);
  //     setIsLoading(false);
  //   }, 800);
  // };
    try {
      const res = await fetch(`http://localhost:4000/api/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      setSearchResults(data);
    } catch (err) {
      console.error("Error fetching datasets:", err);
      setSearchResults([]);
    } finally {
      setIsLoading(false);
    }
  };
  

  const addToCart = (dataset: Dataset) => {
    const existingItem = cartItems.find(item => item.dataset.id === dataset.id);
    if (!existingItem) {
      setCartItems(prev => [...prev, { dataset, quantity: 1, addedAt: new Date() }]);
    }
  };

  const removeFromCart = (datasetId: string) => {
    setCartItems(prev => prev.filter(item => item.dataset.id !== datasetId));
  };

  const isInCart = (datasetId: string) => {
    return cartItems.some(item => item.dataset.id === datasetId);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      {/* Background Pattern */}
      <div className="fixed inset-0 opacity-5">
        <div className="absolute inset-0" style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23000000' fill-opacity='0.1'%3E%3Ccircle cx='7' cy='7' r='1'/%3E%3Ccircle cx='53' cy='53' r='1'/%3E%3Ccircle cx='30' cy='30' r='1'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        }} />
      </div>

      <div className="relative z-10">
        <Header 
          cartItemCount={cartItems.length} 
          cartItems={cartItems}
          onRemoveFromCart={removeFromCart}
        />
        
        <main className="container mx-auto px-4 py-8">
          {/* Hero Section */}
          <div className="text-center mb-12">
            <h1 className="text-4xl md:text-5xl font-bold text-slate-800 mb-4">
              Discover Geospatial Data
            </h1>
            <p className="text-xl text-slate-600 mb-8 max-w-3xl mx-auto">
              Search, explore, and download geospatial datasets with natural language queries. 
              Simplify your research workflow with intelligent data discovery.
            </p>
            
            <SearchBar onSearch={handleSearch} isLoading={isLoading} />
          </div>

          {/* Main Content Area */}
          {searchResults.length > 0 && (
            <div className="grid lg:grid-cols-2 gap-8 mb-8">
              {/* Search Results */}
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-semibold text-slate-800">
                    Search Results
                  </h2>
                  <span className="text-sm text-slate-500">
                    {searchResults.length} datasets found
                  </span>
                </div>
                
                <SearchResults 
                  results={searchResults}
                  onAddToCart={addToCart}
                  onSelectDataset={setSelectedDataset}
                  isInCart={isInCart}
                />
              </div>

              {/* Map Visualization */}
              <div className="lg:sticky lg:top-8 h-fit">
                <MapVisualization datasets={searchResults} />
              </div>
            </div>
          )}

          {/* Empty State */}
          {searchResults.length === 0 && searchQuery && !isLoading && (
            <div className="text-center py-16">
              <div className="w-24 h-24 mx-auto mb-6 bg-slate-100 rounded-full flex items-center justify-center">
                <svg className="w-12 h-12 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-slate-700 mb-2">No datasets found</h3>
              <p className="text-slate-500">Try adjusting your search terms or browse our featured collections.</p>
            </div>
          )}

          {/* Getting Started */}
          {searchResults.length === 0 && !searchQuery && (
            <div className="grid md:grid-cols-3 gap-8 mt-16">
              <div className="text-center p-6">
                <div className="w-16 h-16 mx-auto mb-4 bg-blue-100 rounded-full flex items-center justify-center">
                  <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-slate-800 mb-2">Natural Language Search</h3>
                <p className="text-slate-600">Use plain English to describe the data you need. Try "population density in urban areas" or "climate data for 2023".</p>
              </div>
              
              <div className="text-center p-6">
                <div className="w-16 h-16 mx-auto mb-4 bg-teal-100 rounded-full flex items-center justify-center">
                  <svg className="w-8 h-8 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-slate-800 mb-2">Visual Data Preview</h3>
                <p className="text-slate-600">See geographic footprints and data coverage areas on our interactive map before downloading.</p>
              </div>
              
              <div className="text-center p-6">
                <div className="w-16 h-16 mx-auto mb-4 bg-green-100 rounded-full flex items-center justify-center">
                  <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4m0 0L7 13m0 0l-2.5 5M7 13l2.5 5m6.5-5v5a2 2 0 01-2 2H9a2 2 0 01-2-2v-5m8 0V9a2 2 0 00-2-2H9a2 2 0 00-2 2v4.01" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-slate-800 mb-2">Batch Downloads</h3>
                <p className="text-slate-600">Add multiple datasets to your cart and download them together in your preferred format.</p>
              </div>
            </div>
          )}
        </main>

        {/* Dataset Detail Modal */}
        {selectedDataset && (
          <DatasetModal 
            dataset={selectedDataset}
            onClose={() => setSelectedDataset(null)}
            onAddToCart={addToCart}
            isInCart={isInCart(selectedDataset.id)}
          />
        )}
      </div>
    </div>
  );
}

export default App;