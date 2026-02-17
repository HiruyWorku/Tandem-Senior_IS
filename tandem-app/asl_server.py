import os
import sys

from flask import Flask, Response
import cv2
import pickle
import mediapipe as mp
import numpy as np
from asl.labels_dict import labels_dict

app = Flask(__name__)

gesture_classifier = None
mp_hands = None
mp_drawing = None
mp_drawing_styles = None
hands = None
camera = None

TEXT_COLOR = (255, 250, 0)
BBOX_COLOR = (0, 0, 0)
TEXT_SCALE = 1.3
TEXT_THICKNESS = 3


def init_classifier():
    global gesture_classifier, mp_hands, mp_drawing, mp_drawing_styles, hands, camera
    
    asl_dir = os.path.join(os.path.dirname(__file__), 'asl')
    model_path = os.path.join(asl_dir, 'model.p')
    
    model_dict = pickle.load(open(model_path, "rb"))
    gesture_classifier = model_dict["model"]
    
    mp_hands = mp.solutions.hands
    mp_drawing = mp.solutions.drawing_utils
    mp_drawing_styles = mp.solutions.drawing_styles
    
    hands = mp_hands.Hands(
        static_image_mode=True, 
        min_detection_confidence=0.3
    )
    
    camera = cv2.VideoCapture(0)
    print('[ASL] Classifier initialized')


def predict_gesture(frame):
    data_aux = []
    x_ = []
    y_ = []

    H, W, _ = frame.shape
    frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

    results = hands.process(frame_rgb)
    predicted_character = None

    if results.multi_hand_landmarks:
        for hand_landmarks in results.multi_hand_landmarks:
            mp_drawing.draw_landmarks(
                frame,
                hand_landmarks,
                mp_hands.HAND_CONNECTIONS,
                mp_drawing_styles.get_default_hand_landmarks_style(),
                mp_drawing_styles.get_default_hand_connections_style(),
            )

        for hand_landmarks in results.multi_hand_landmarks:
            for i in range(len(hand_landmarks.landmark)):
                x = hand_landmarks.landmark[i].x
                y = hand_landmarks.landmark[i].y
                x_.append(x)
                y_.append(y)

            for i in range(len(hand_landmarks.landmark)):
                x = hand_landmarks.landmark[i].x
                y = hand_landmarks.landmark[i].y
                data_aux.append(x - min(x_))
                data_aux.append(y - min(y_))

        x1 = int(min(x_) * W) - 10
        y1 = int(min(y_) * H) - 10
        x2 = int(max(x_) * W) - 10
        y2 = int(max(y_) * H) - 10

        prediction = gesture_classifier.predict(
            [np.asarray(data_aux + [0] * (84 - len(data_aux)))]
        )
        predicted_character = labels_dict[prediction[0]]

        cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 0, 0), 4)
        cv2.rectangle(frame, (x1, y1), (x2, y2), BBOX_COLOR, 4)
        cv2.putText(
            frame,
            predicted_character,
            (x1, y1 - 10),
            cv2.FONT_HERSHEY_SIMPLEX,
            TEXT_SCALE,
            TEXT_COLOR,
            TEXT_THICKNESS,
            cv2.LINE_AA,
        )

    return predicted_character, frame


def generate_video():
    while True:
        success, frame = camera.read()
        if not success:
            break

        predicted_character, frame = predict_gesture(frame)

        ret, jpeg = cv2.imencode(".jpg", frame)
        frame_bytes = jpeg.tobytes()

        yield (
            b"--frame\r\n"
            b"Content-Type: image/jpeg\r\n\r\n" + frame_bytes + b"\r\n\r\n"
        )


@app.route('/asl_stream')
def video_feed():
    return Response(
        generate_video(), mimetype="multipart/x-mixed-replace; boundary=frame"
    )


if __name__ == "__main__":
    init_classifier()
    print('[ASL] Starting ASL Recognition Server on port 5001')
    app.run(host='0.0.0.0', port=5001, debug=False, threaded=True)
