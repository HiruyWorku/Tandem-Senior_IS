from flask import Flask, request, jsonify
from flask_cors import CORS
import pickle
import numpy as np

app = Flask(__name__)
CORS(app)

# Load model
with open('asl/model.p', 'rb') as f:
    model_dict = pickle.load(f)
model = model_dict['model']

print(f"Model loaded: {model.n_features_in_} features, {len(model.classes_)} classes")

@app.route('/predict', methods=['POST'])
def predict():
    data = request.json
    features = np.array(data.get('features', []))
    
    if len(features) == 0:
        return jsonify({'error': 'No features provided'}), 400
    
    # Pad to 84 features
    if len(features) < 84:
        features = np.pad(features, (0, 84 - len(features)))
    
    # Make prediction
    prediction = model.predict([features])[0]
    probabilities = model.predict_proba([features])[0]
    
    return jsonify({
        'prediction': prediction,
        'probability': float(max(probabilities)),
        'classes': model.classes_.tolist()
    })

@app.route('/health')
def health():
    return 'OK'

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5003, debug=False)
