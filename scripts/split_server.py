#!/usr/bin/env python3
"""Split monolithic server.py into domain router modules.

Usage: python3 scripts/split_server.py
Creates src/api/routers/*.py from src/api/server.py route groups.
"""

import os, re

SERVER = "src/api/server.py"
ROUTERS = "src/api/routers"

# Domain classification by route path prefix
DOMAINS = {
    "/api/auth/": "auth", "/api/admin/users": "auth", "/api/me": "auth",
    "/api/tags": "tags", "/api/tag-": "tags", "/api/email/": "tags",
    "/api/search": "search",
    "/api/ask": "ask",
    "/api/translate": "translations",
    "/api/annotations": "annotations", "/api/admin/annotations": "annotations",
    "/api/thread/": "annotations", "/api/stats": "annotations",
    "/api/manual/": "manual",
    "/api/kernel/": "kernel",
    "/api/knowledge/": "knowledge",
    "/api/agent/": "agent",
}

# Which domain does a route path belong to?
def classify(path):
    for prefix, domain in DOMAINS.items():
        if path.startswith(prefix):
            return domain
    if path in ("/", "/api/"):
        return "system"
    return "system"

# Read server.py
with open(SERVER, "r") as f:
    lines = f.readlines()

# Find @app.route -> function definitions with their boundaries
i = 0
routes = []
while i < len(lines):
    m = re.match(r'@app\.(get|post|put|patch|delete)\(["\']([^"\']+)["\']', lines[i])
    if m:
        method, path = m.group(1), m.group(2)
        # Find function name
        func_name = None
        for j in range(i+1, min(i+5, len(lines))):
            fm = re.match(r'async def (\w+)\(', lines[j])
            if fm:
                func_name = fm.group(1)
                break
        if func_name:
            # Find end: next @app or next top-level def
            end = len(lines)
            for j in range(i+2, len(lines)):
                lj = lines[j]
                if re.match(r'@app\.(get|post|put|patch|delete)\(', lj):
                    end = j; break
                if re.match(r'(async )?def \w+\(', lj) and not lj.startswith(' '):
                    # Check if it's a new route function, not a nested one
                    end = j; break
                if lj.startswith('# ===================================='):
                    end = j; break
            routes.append((i, end, path, method, func_name, classify(path)))
    i += 1

# Collect Pydantic models between routes (used by specific domains)
# Models are classes defined with `class ...(BaseModel):`
models = {}
current_domain = "system"
for idx in range(len(lines)):
    m = re.match(r'class (\w+)\(BaseModel\):', lines[idx])
    if m:
        model_name = m.group(1)
        # Find end of class (first top-level def/class after this)
        end = len(lines)
        for j in range(idx+1, len(lines)):
            lj = lines[j]
            if re.match(r'^(class |async def |def |@app\.)', lj):
                end = j; break
            if lj.startswith('# ===================================='):
                end = j; break
        models[model_name] = (idx, end)

# Print summary
dom_counts = {}
for _, _, _, _, _, d in routes:
    dom_counts[d] = dom_counts.get(d, 0) + 1
print(f"Routes by domain: {dom_counts}")
print(f"Total routes: {len(routes)}")
print(f"Models found: {list(models.keys())}")
print("\nNow create router files by running the full extraction...")
