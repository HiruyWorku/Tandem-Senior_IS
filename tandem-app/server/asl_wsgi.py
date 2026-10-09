"""Private WSGI entrypoint; fail closed on incompatible trusted artifacts."""
import logging
import warnings

from sklearn.exceptions import InconsistentVersionWarning
from server.asl_api import create_app

try:
    with warnings.catch_warnings():
        warnings.simplefilter('error', InconsistentVersionWarning)
        app = create_app()
except Exception:
    logging.getLogger('asl_wsgi').critical('Fingerspelling model startup failed.')
    raise SystemExit('Fingerspelling model startup failed.') from None
