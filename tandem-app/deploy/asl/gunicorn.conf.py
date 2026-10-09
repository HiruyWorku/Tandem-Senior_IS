# Private HTTP/1 WSGI inference, with one BLAS thread and bounded worker lifetime.
bind = '0.0.0.0:5003'
workers = 1
worker_class = 'sync'
preload_app = True
timeout = 10
graceful_timeout = 5
backlog = 16
max_requests = 5000
max_requests_jitter = 100
limit_request_line = 2048
limit_request_fields = 20
limit_request_field_size = 4096
worker_tmp_dir = '/tmp'
accesslog = None
errorlog = '-'
loglevel = 'warning'
