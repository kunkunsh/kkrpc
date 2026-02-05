import json
import random
from typing import Any, Dict

CALLBACK_PREFIX = "__callback__"


def generate_uuid() -> str:
	return "-".join(f"{random.getrandbits(53):x}" for _ in range(4))


def encode_message(payload: Dict[str, Any]) -> str:
	return json.dumps(payload, ensure_ascii=False) + "\n"


def decode_message(message: str) -> Dict[str, Any]:
	return json.loads(message)
