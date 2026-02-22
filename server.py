import os
import json
from flask import Flask, request, jsonify, send_from_directory, Response
from flask_cors import CORS
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__, static_folder='.')
CORS(app)

# Supabase configuration
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")
supabase: Client = None

if SUPABASE_URL and SUPABASE_KEY:
    try:
        supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
        print("Supabase client initialized.")
    except Exception as e:
        print(f"Failed to initialize Supabase: {e}")
else:
    print("Supabase credentials not found. Using local db.json fallback.")

DB_FILE = 'db.json'

def get_db_data():
    if supabase:
        try:
            res = supabase.table('parking_state').select('*').eq('id', 1).execute()
            if res.data:
                return res.data[0]['data']
            else:
                initial_data = {
                    "reservations": {"1": {}, "2": {}, "3": {}, "4": {}}, 
                    "penalties": {},
                    "reports": {},
                    "logs": []
                }
                supabase.table('parking_state').insert({"id": 1, "data": initial_data}).execute()
                return initial_data
        except Exception as e:
            print(f"Supabase error: {e}")
    
    if os.path.exists(DB_FILE):
        with open(DB_FILE, 'r') as f:
            return json.load(f)
    return {"reservations": {"1": {}, "2": {}, "3": {}, "4": {}}, "penalties": {}, "reports": {}, "logs": []}

def get_tokens():
    if supabase:
        try:
            res = supabase.table('parking_tokens').select('*').execute()
            return {item['token']: item['apt'] for item in res.data}
        except Exception as e:
            print(f"Supabase tokens error: {e}")
    
    if os.path.exists('tokens.json'):
        with open('tokens.json', 'r') as f:
            return json.load(f)
    return {}

def check_auth(username, password):
    # Identifiants simples pour l'accès gérant
    return username == 'admin' and password == 'parking26'

def authenticate():
    return Response(
        'Accès refusé. Authentification requise.', 401,
        {'WWW-Authenticate': 'Basic realm="Accès Gérant"'}
    )

@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/manager.html')
def manager_page():
    auth = request.authorization
    if not auth or not check_auth(auth.username, auth.password):
        return authenticate()
    return send_from_directory('.', 'manager.html')

@app.route('/<path:path>')
def static_files(path):
    return send_from_directory('.', path)

@app.route('/api/db', methods=['GET'])
def get_db():
    return jsonify(get_db_data())

@app.route('/api/db', methods=['POST'])
def save_db():
    data = request.json
    if 'tokens' in data: del data['tokens']
    
    if supabase:
        try:
            supabase.table('parking_state').update({"data": data}).eq('id', 1).execute()
        except Exception as e:
            return jsonify({"error": str(e)}), 400
    else:
        with open(DB_FILE, 'w') as f:
            json.dump(data, f)
            
    return jsonify({"status": "ok"})

@app.route('/api/tokens', methods=['GET'])
def list_tokens():
    return jsonify(get_tokens())

@app.route('/api/validate_token', methods=['GET'])
def validate_token():
    token = request.args.get('token')
    tokens = get_tokens()
    if token in tokens:
        return jsonify({"status": "ok", "apt": tokens[token]})
    return jsonify({"status": "error", "message": "Invalid token"}), 400

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 8000))
    print(f"Starting Flask server on port {port}...")
    app.run(host='0.0.0.0', port=port)
