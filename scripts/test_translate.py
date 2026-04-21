#!/usr/bin/env python3
"""测试翻译功能"""

import urllib.request
import urllib.parse
import json

def test_translate(text: str, target_lang: str = "zh-CN") -> str:
    """直接测试 Google Translate API"""
    url = "https://translate.googleapis.com/translate_a/single"
    params = {
        'client': 'gtx',
        'sl': 'auto',
        'tl': target_lang,
        'dt': 't',
        'ie': 'UTF-8',
        'oe': 'UTF-8',
        'q': text
    }
    
    url_with_params = f"{url}?{urllib.parse.urlencode(params)}"
    print(f"Request URL: {url_with_params}")
    
    req = urllib.request.Request(
        url_with_params,
        headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
    )
    
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            result = json.loads(response.read().decode('utf-8'))
            print(f"Raw response: {result}")
            
            # 解析返回结果
            if result and len(result) > 0:
                translations = []
                first_elem = result[0]
                
                if isinstance(first_elem, list):
                    for item in first_elem:
                        if isinstance(item, list) and len(item) > 0:
                            trans = item[0]
                            if trans:
                                translations.append(trans)
                
                if translations:
                    return ''.join(translations)
            
            return text
    except Exception as e:
        print(f"Error: {e}")
        return text


if __name__ == "__main__":
    test_text = "Hello, how are you today?"
    print(f"Testing translation: '{test_text}'")
    result = test_translate(test_text)
    print(f"Result: '{result}'")