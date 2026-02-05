
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
    text = re.sub(r'[\|\"\(\)\[\]\{\}\/\,]', ' ', text)
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
        'processed_texts': [clean_and_lemmatize(t) for t in texts],
        'dimension': len(embeddings[0]) if len(embeddings) > 0 else 0
    }
    print(json.dumps(result))

if __name__ == '__main__':
    main()
