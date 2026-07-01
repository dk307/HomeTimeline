.PHONY: help validate deploy deploy-force test logs shell status

help:
	@echo ""
	@echo "  validate       Run unit + integration tests"
	@echo "  deploy         Validate, sync, build, restart, health-check"
	@echo "  deploy-force   Deploy without running tests"
	@echo "  logs           Tail production container logs (runs in Cowork session)"
	@echo "  shell          Open shell in production container"
	@echo "  status         Show container status"
	@echo ""

validate:
	python -m pytest tests/unit tests/integration -v --tb=short

test: validate

deploy:
	python scripts/deploy.py

deploy-force:
	python scripts/deploy.py --skip-tests

logs:
	python -c "
import paramiko, sys, time
from pathlib import Path

def load_env(p):
    r = {}
    if Path(p).exists():
        for l in open(p):
            l = l.strip()
            if l and not l.startswith('#') and '=' in l:
                k, _, v = l.partition('=')
                r[k.strip()] = v.strip().strip('\"').strip(\"'\")
    return r

env = load_env('.env')
host = env.get('DEPLOY_HOST', 'root@192.168.1.164')
user, _, hostname = host.partition('@')
pw = env.get('DEPLOY_PASS', '')
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(hostname, username=user, password=pw or None, timeout=10)
_, out, _ = ssh.exec_command('podman logs -f camera-event-manager', timeout=300)
try:
    for line in out:
        print(line, end='')
except KeyboardInterrupt:
    pass
ssh.close()
"

status:
	python -c "
import paramiko
from pathlib import Path

def load_env(p):
    r = {}
    if Path(p).exists():
        for l in open(p):
            l = l.strip()
            if l and not l.startswith('#') and '=' in l:
                k, _, v = l.partition('=')
                r[k.strip()] = v.strip().strip('\"').strip(\"'\")
    return r

env = load_env('.env')
host = env.get('DEPLOY_HOST', 'root@192.168.1.164')
user, _, hostname = host.partition('@')
pw = env.get('DEPLOY_PASS', '')
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(hostname, username=user, password=pw or None, timeout=10)
_, out, _ = ssh.exec_command('podman ps -a --filter name=camera-event-manager', timeout=10)
print(out.read().decode())
ssh.close()
"
