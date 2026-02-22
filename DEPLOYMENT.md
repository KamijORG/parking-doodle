# Guide de Déploiement Cloud (Supabase + Render)

Votre application est prête pour le cloud ! Voici les étapes pour la rendre accessible partout gratuitement.

## 1. Base de données : Supabase (Gratuit)
Supabase va remplacer votre fichier `db.json` pour garder vos données à vie.
1. Créez un compte sur [Supabase.com](https://supabase.com/).
2. Créez un nouveau projet "Parking".
3. Allez dans l'onglet **SQL Editor** et créez une nouvelle requête.
4. Copiez et collez le contenu du fichier [setup_supabase.sql](file:///Users/macburgpro/.gemini/antigravity/scratch/parking-doodle/setup_supabase.sql) puis cliquez sur **Run**.
5. Allez dans **Project Settings > API** et récupérez :
    - `Project URL`
    - `API Key (anon)`

## 2. Hébergement : Render (Gratuit)
Render va faire tourner votre serveur Python.
1. Créez un compte sur [Render.com](https://render.com/).
2. Créez un nouveau **Web Service**.
3. Liez votre dépôt GitHub (ou uploadez vos fichiers).
4. Paramètres :
    - **Runtime**: `Python 3`
    - **Build Command**: `python -m pip install -r requirements.txt`
    - **Start Command**: `gunicorn server:app`
5. Allez dans **Environment** et ajoutez les variables suivantes récupérées sur Supabase :
    - `SUPABASE_URL` : Votre URL de projet
    - `SUPABASE_KEY` : Votre clé API (anon)

## 3. Accès final
Une fois que Render a fini le build (environ 2 min), votre site sera accessible à une adresse type `https://parking26.onrender.com`.

### Mobile (5G / WiFi)
Scannez simplement les nouveaux QR codes générés sur le **Tableau de bord gérant**. Ils utiliseront automatiquement l'adresse publique de Render, donc plus besoin de configurer d'IP locale !

---
**Note** : Si vous achetez `parking26.com` plus tard, vous pourrez l'ajouter dans les paramètres "Custom Domains" de Render.
