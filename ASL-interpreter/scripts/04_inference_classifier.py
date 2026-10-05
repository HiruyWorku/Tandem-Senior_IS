import pickle
import cv2
import mediapipe as mp

# The `mediapipe` package has multiple APIs. Older examples use
# `mediapipe.solutions` (mp.solutions.*). Newer installations may only
# provide the `mediapipe.tasks` API which doesn't expose `solutions` at
# top-level. Guard the import and produce a helpful error if `solutions`
# isn't available.
if not hasattr(mp, "solutions"):
    raise ImportError(
        "The installed 'mediapipe' package does not expose 'solutions'.\n"
        "Install a mediapipe build that provides the classic solutions API,\n"
        "for example: pip install mediapipe==0.10.0 (or use the project venv)."
    )


# Appearance settings: change these to alter overlay colors/sizes
# Colors are BGR tuples (blue, green, red) as used by OpenCV.
TEXT_COLOR = (255, 250, 0)  # default gray
BBOX_COLOR = (0, 0, 0)  # default black box
TEXT_SCALE = 1.3
TEXT_THICKNESS = 3


def hex_to_bgr(hex_str: str):
    """Convert a hex color '#RRGGBB' or 'RRGGBB' to an OpenCV BGR tuple.

    Example: hex_to_bgr('#FF0000') -> (0, 0, 255) for red.
    """
    s = hex_str.lstrip("#")
    if len(s) != 6:
        raise ValueError("hex color must be 6 hex digits, e.g. '#FF00AA'")
    r = int(s[0:2], 16)
    g = int(s[2:4], 16)
    b = int(s[4:6], 16)
    return (b, g, r)
import numpy as np
from labels_dict import labels_dict


class GestureClassifier:
    def __init__(self):
        self.model_dict = pickle.load(open("./model.p", "rb"))
        self.model = self.model_dict["model"]

        self.mp_hands = mp.solutions.hands
        self.mp_drawing = mp.solutions.drawing_utils
        self.mp_drawing_styles = mp.solutions.drawing_styles

        self.hands = self.mp_hands.Hands(
            static_image_mode=True, min_detection_confidence=0.3
        )

    def predict(self, frame):
        data_aux = []
        x_ = []
        y_ = []

        H, W, _ = frame.shape
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

        results = self.hands.process(frame_rgb)
        predicted_character = None  # Initialize to None

        if results.multi_hand_landmarks:
            for hand_landmarks in results.multi_hand_landmarks:
                self.mp_drawing.draw_landmarks(
                    frame,
                    hand_landmarks,
                    self.mp_hands.HAND_CONNECTIONS,
                    self.mp_drawing_styles.get_default_hand_landmarks_style(),
                    self.mp_drawing_styles.get_default_hand_connections_style(),
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

            prediction = self.model.predict(
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
