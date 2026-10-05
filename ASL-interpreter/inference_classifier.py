import importlib.util
import os

# Lazily load the original script (which has a leading '04_' filename) to avoid
# requiring the file to be importable as a normal Python module name.
_module = None

def _load_module():
    global _module
    if _module is None:
        script_path = os.path.join(os.path.dirname(__file__), "scripts", "04_inference_classifier.py")
        spec = importlib.util.spec_from_file_location("inference_from_scripts", script_path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        _module = mod
    return _module

class GestureClassifier:
    """Thin wrapper that forwards calls to the actual GestureClassifier
    defined in scripts/04_inference_classifier.py. The real module is loaded
    the first time an instance is created, so importing this module is cheap.
    """

    def __init__(self, *args, **kwargs):
        mod = _load_module()
        self._impl = mod.GestureClassifier(*args, **kwargs)

    def __getattr__(self, name):
        return getattr(self._impl, name)
