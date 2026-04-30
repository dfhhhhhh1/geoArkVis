
import sys
import json
import numpy as np
from sentence_transformers import SentenceTransformer

def main():
    # Load model
    model = SentenceTransformer('all-MiniLM-L6-v2')
    
    # Read input from stdin
    input_data = json.loads(sys.stdin.read())
    texts = input_data['texts']
    
    # Generate embeddings
    embeddings = model.encode(texts)
    
    # Convert to list for JSON serialization
    embeddings_list = embeddings.tolist()
    
    # Output as JSON
    result = {
        'embeddings': embeddings_list,
        'dimension': len(embeddings_list[0]) if embeddings_list else 0
    }
    
    print(json.dumps(result))

if __name__ == '__main__':
    main()
