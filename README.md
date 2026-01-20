Agentic Natural language convert to SQL with smart recommendations - [Google Colab](https://colab.research.google.com/drive/1iCTzFps7Zx5jOyg4lLLyEIJMXEGMflU0?usp=sharing)

This is the UI for the GeoARK project. It needs a backend to communicate with for api calls and ai/llm search requests.

to run, run these commands:

source ../myenv/bin/activate

docker compose up -d --build


# This Process should take around ~6 minutes depending on hardware

For changes to one file in the backend, you can run this command to update the docker container: 
docker-compose up -d --build backend

For frontend:
docker-compose up -d --build frontend

