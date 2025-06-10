import React from 'react';
import { 
  ShoppingCart, 
  Eye, 
  Download, 
  Clock, 
  Database, 
  MapPin, 
  CheckCircle 
} from 'lucide-react';
import { Dataset } from '../types';

interface DatasetCardProps {
  dataset: Dataset;
  onAddToCart: (dataset: Dataset) => void;
  onSelect: (dataset: Dataset) => void;
  isInCart: boolean;
}

const DatasetCard: React.FC<DatasetCardProps> = ({ 
  dataset, 
  onAddToCart, 
  onSelect, 
  isInCart 
}) => {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 hover:shadow-lg transition-all duration-200 hover:border-slate-300">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-slate-800 mb-2 hover:text-blue-600 cursor-pointer" 
              onClick={() => onSelect(dataset)}>
            {dataset.title}
          </h3>
          <p className="text-slate-600 text-sm leading-relaxed mb-3">
            {dataset.description}
          </p>
          
          {/* Source and Coverage */}
          <div className="flex items-center space-x-4 text-sm text-slate-500 mb-3">
            <div className="flex items-center space-x-1">
              <Database className="w-4 h-4" />
              <span>{dataset.source}</span>
            </div>
            <div className="flex items-center space-x-1">
              <MapPin className="w-4 h-4" />
              <span>{dataset.coverage.geographic}</span>
            </div>
            <div className="flex items-center space-x-1">
              <Clock className="w-4 h-4" />
              <span>{dataset.lastUpdated}</span>
            </div>
          </div>
        </div>
        
        {/* Preview Thumbnail */}
        {dataset.previewUrl && (
          <div className="ml-4 flex-shrink-0">
            <img 
              src={dataset.previewUrl} 
              alt={`${dataset.title} preview`}
              className="w-20 h-20 rounded-lg object-cover border border-slate-200"
            />
          </div>
        )}
      </div>

      {/* Fields Preview */}
      <div className="mb-4">
        <p className="text-sm font-medium text-slate-700 mb-2">
          Contains fields on:
        </p>
        <div className="flex flex-wrap gap-2">
          {dataset.fields.slice(0, 4).map((field, index) => (
            <span 
              key={index}
              className="px-2 py-1 bg-blue-50 text-blue-700 text-xs rounded-md font-medium"
            >
              {field.replace('_', ' ')}
            </span>
          ))}
          {dataset.fields.length > 4 && (
            <span className="px-2 py-1 bg-slate-100 text-slate-600 text-xs rounded-md">
              +{dataset.fields.length - 4} more
            </span>
          )}
        </div>
      </div>

      {/* Tags */}
      <div className="mb-4">
        <div className="flex flex-wrap gap-1">
          {dataset.tags.slice(0, 5).map((tag, index) => (
            <span 
              key={index}
              className="px-2 py-1 bg-slate-100 text-slate-600 text-xs rounded-md"
            >
              #{tag}
            </span>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-4 border-t border-slate-100">
        <div className="flex items-center space-x-4 text-sm text-slate-500">
          <span className="font-medium">{dataset.fileSize}</span>
          <span>•</span>
          <span>{dataset.coverage.temporal}</span>
        </div>
        
        <div className="flex items-center space-x-2">
          <button
            onClick={() => onSelect(dataset)}
            className="flex items-center space-x-1 px-3 py-1.5 text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors text-sm"
          >
            <Eye className="w-4 h-4" />
            <span>View Details</span>
          </button>
          
          <button
            onClick={() => onAddToCart(dataset)}
            disabled={isInCart}
            className={`flex items-center space-x-1 px-4 py-1.5 rounded-lg transition-all text-sm font-medium ${
              isInCart
                ? 'bg-green-100 text-green-700 cursor-default'
                : 'bg-blue-600 text-white hover:bg-blue-700 hover:shadow-md'
            }`}
          >
            {isInCart ? (
              <>
                <CheckCircle className="w-4 h-4" />
                <span>In Cart</span>
              </>
            ) : (
              <>
                <ShoppingCart className="w-4 h-4" />
                <span>Add to Cart</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DatasetCard;