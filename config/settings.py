"""配置管理模块 - 从 settings.yaml 加载配置。

所有配置必须通过此模块访问，禁止在代码中硬编码配置值。
"""

from pathlib import Path
from typing import Optional

import yaml

# 缓存加载的配置
_config: Optional[dict] = None


def _get_config_path() -> Path:
    """获取配置文件路径。"""
    return Path(__file__).resolve().parent / "settings.yaml"


def load_config() -> dict:
    """加载配置文件。"""
    global _config
    if _config is not None:
        return _config

    config_path = _get_config_path()
    if config_path.exists():
        with open(config_path, "r", encoding="utf-8") as f:
            _config = yaml.safe_load(f) or {}
    else:
        _config = {}
    return _config


class Settings:
    """配置类，提供类型化的配置访问。"""

    def __init__(self, config: dict):
        self._config = config

    @property
    def storage(self) -> dict:
        """存储配置。"""
        return self._config.get("storage", {})

    @property
    def indexer(self) -> dict:
        """索引配置。"""
        return self._config.get("indexer", {})

    @property
    def retriever(self) -> dict:
        """检索配置。"""
        return self._config.get("retriever", {})

    @property
    def qa(self) -> dict:
        """问答配置。"""
        return self._config.get("qa", {})

    @property
    def email_collector(self) -> dict:
        """邮件采集配置。"""
        return self._config.get("email_collector", {})

    @property
    def manual_collector(self) -> dict:
        """手册采集配置。"""
        return self._config.get("manual_collector", {})

    @property
    def chunker(self) -> dict:
        """分片配置。"""
        return self._config.get("chunker", {})

    @property
    def translator(self) -> dict:
        """翻译配置。"""
        return self._config.get("translator", {})


def get_settings() -> Settings:
    """获取配置实例（单例）。"""
    config = load_config()
    return Settings(config)


def reload_config() -> Settings:
    """重新加载配置（清除缓存）。"""
    global _config
    _config = None
    return get_settings()