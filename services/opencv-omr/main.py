"""
Microservicio OMR real con OpenCV.
POST /read-omr — lectura real de imagen.
GET /health — estado del servicio.
"""
import os
import logging

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from omr_engine import run_omr

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="OpenCV OMR Service", version="1.0.0")


class ReadOmrRequest(BaseModel):
    imageBase64: str
    templateId: str = "default"
    numQuestions: int = 40
    optionLabels: list[str] = ["A", "B", "C", "D"]


@app.get("/health")
def health():
    return {"ok": True, "service": "opencv-omr", "engine": "opencv"}


@app.post("/read-omr")
def read_omr(body: ReadOmrRequest):
    try:
        logger.info("[OPENCV_OMR] request recibida")
        num_questions = max(1, min(200, body.numQuestions))
        option_labels = body.optionLabels or ["A", "B", "C", "D"]

        results, omissions, double_marks, processing_time_ms, extra_meta = run_omr(
            body.imageBase64,
            num_questions=num_questions,
            option_labels=option_labels,
            template_id=body.templateId,
        )

        metadata = {
            "engine": "opencv",
            "processingTimeMs": round(processing_time_ms, 0),
        }
        if extra_meta.get("flatScoresDetected"):
            metadata["flatScoresDetected"] = True

        return {
            "success": True,
            "results": results,
            "omissions": omissions,
            "doubleMarks": double_marks,
            "metadata": metadata,
        }
    except ValueError as e:
        logger.error("[OPENCV_OMR] error: %s", str(e))
        return {"success": False, "error": str(e)}
    except Exception as e:
        logger.exception("[OPENCV_OMR] error")
        return {"success": False, "error": str(e)}
