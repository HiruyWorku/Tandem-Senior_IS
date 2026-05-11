#!/usr/bin/env python3
"""
ASL Data Collection — v2
=========================
Collects 500 camera frames per sign class with real-time MediaPipe overlay
so you can verify your hand is being tracked before samples are saved.

Usage
-----
    cd tandem-app
    python asl/collect.py

Controls (during capture)
-------------------------
    SPACE  — toggle capture pause / resume
    N      — skip to next class
    Q / ESC — quit early

Output
------
    asl/data_v2/<label>/0001.jpg … 0500.jpg

After collection, run:
    python asl/train.py
"""

import os
import sys
import time
import cv2
import mediapipe as mp

# ── Config ─────────────────────────────────────────────────────────────────
SAMPLES_PER_CLASS  = 500
DATA_DIR           = os.path.join(os.path.dirname(__file__), 'data_v2')
CAPTURE_DELAY_S    = 2.0   # countdown seconds before capture starts
MIN_DETECTION_CONF = 0.5

# Default classes: A-Z.  Edit or extend as needed.
DEFAULT_CLASSES = list('ABCDEFGHIJKLMNOPQRSTUVWXYZ')

# ── MediaPipe setup ─────────────────────────────────────────────────────────
mp_hands   = mp.solutions.hands
mp_drawing = mp.solutions.drawing_utils
mp_styles  = mp.solutions.drawing_styles

# ── Helpers ─────────────────────────────────────────────────────────────────

def overlay_text(frame, text, y, color=(255, 255, 255), scale=0.8, thickness=2):
    cv2.putText(frame, text, (20, y), cv2.FONT_HERSHEY_SIMPLEX,
                scale, (0, 0, 0), thickness + 2, cv2.LINE_AA)
    cv2.putText(frame, text, (20, y), cv2.FONT_HERSHEY_SIMPLEX,
                scale, color, thickness, cv2.LINE_AA)


def collect_class(cap, hands, label, out_dir, n_samples):
    os.makedirs(out_dir, exist_ok=True)
    existing = len([f for f in os.listdir(out_dir) if f.endswith('.jpg')])

    print(f'\n{"─"*50}')
    print(f'  Class: {label!r}   already collected: {existing}/{n_samples}')
    print(f'  Press SPACE when ready — N to skip — Q to quit')
    print(f'{"─"*50}')

    state       = 'wait'    # wait → countdown → capture → done
    countdown_t = None
    paused      = False
    count       = existing

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results   = hands.process(frame_rgb)

        # Draw landmarks
        hand_visible = False
        if results.multi_hand_landmarks:
            hand_visible = True
            for hlm in results.multi_hand_landmarks:
                mp_drawing.draw_landmarks(
                    frame, hlm, mp_hands.HAND_CONNECTIONS,
                    mp_styles.get_default_hand_landmarks_style(),
                    mp_styles.get_default_hand_connections_style(),
                )

        # Progress bar
        progress = int((count / n_samples) * frame.shape[1])
        cv2.rectangle(frame, (0, frame.shape[0]-8),
                      (progress, frame.shape[0]), (0, 200, 120), -1)

        # HUD
        overlay_text(frame, f'Sign: {label}', 40, (0, 230, 140), 1.2, 3)
        overlay_text(frame, f'{count}/{n_samples} captured', 78)

        if not hand_visible:
            overlay_text(frame, 'No hand detected', 120, (80, 80, 255))

        if state == 'wait':
            overlay_text(frame, 'Press SPACE to start', 160, (200, 200, 0))

        elif state == 'countdown':
            elapsed = time.time() - countdown_t
            remaining = max(0.0, CAPTURE_DELAY_S - elapsed)
            overlay_text(frame, f'Starting in {remaining:.1f}s…', 160, (0, 200, 255))
            if remaining <= 0:
                state = 'capture'

        elif state == 'capture':
            if paused:
                overlay_text(frame, 'PAUSED — SPACE to resume', 160, (80, 80, 255))
            else:
                overlay_text(frame, 'CAPTURING…', 160, (0, 255, 100))
                if hand_visible and count < n_samples:
                    fname = os.path.join(out_dir, f'{count+1:04d}.jpg')
                    cv2.imwrite(fname, frame)
                    count += 1
                if count >= n_samples:
                    state = 'done'

        elif state == 'done':
            overlay_text(frame, f'Done! {n_samples} samples collected.', 160, (0, 255, 100))
            overlay_text(frame, 'Press N for next class', 200)

        cv2.imshow('Tandem — Data Collection', frame)
        key = cv2.waitKey(10) & 0xFF

        if key == ord('q') or key == 27:
            return 'quit'
        if key == ord('n') or state == 'done':
            if key == ord('n') or state == 'done':
                return 'next'
        if key == ord(' '):
            if state == 'wait':
                state      = 'countdown'
                countdown_t = time.time()
            elif state == 'capture':
                paused = not paused

    return 'next'


def main():
    classes = DEFAULT_CLASSES

    # Allow overriding classes via CLI: python collect.py A B C
    if len(sys.argv) > 1:
        classes = [a.strip().upper() for a in sys.argv[1:] if a.strip()]

    print('\nTandem ASL Data Collection v2')
    print(f'Classes to collect: {", ".join(classes)}')
    print(f'Samples per class : {SAMPLES_PER_CLASS}')
    print(f'Output directory  : {DATA_DIR}\n')

    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print('ERROR: Cannot open camera 0')
        sys.exit(1)

    cap.set(cv2.CAP_PROP_FRAME_WIDTH,  640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

    with mp_hands.Hands(
        static_image_mode=False,
        max_num_hands=1,
        min_detection_confidence=MIN_DETECTION_CONF,
        min_tracking_confidence=0.5,
    ) as hands:
        for label in classes:
            out_dir = os.path.join(DATA_DIR, label)
            result  = collect_class(cap, hands, label, out_dir, SAMPLES_PER_CLASS)
            if result == 'quit':
                print('\nCollection stopped early.')
                break

    cap.release()
    cv2.destroyAllWindows()
    print(f'\nAll done. Data saved to: {DATA_DIR}')
    print('Next step: python asl/train.py')


if __name__ == '__main__':
    main()
