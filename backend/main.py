from fastapi import FastAPI

app = FastAPI(title="UK Tick Tracker")


@app.get("/api/health")
def health():
    return {"status": "ok"}