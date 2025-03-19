# serialization.py
import json
import uuid
from typing import Dict, Any, Optional, List


class Message:
    def __init__(
        self,
        id: str,
        method: str,
        args: Any,
        type: str,
        callback_ids: Optional[List[str]] = None,
        version: str = "json",
    ):
        self.id = id
        self.method = method
        self.args = args
        self.type = type
        self.callback_ids = callback_ids
        self.version = version

    def to_dict(self) -> Dict[str, Any]:
        result = {
            "id": self.id,
            "method": self.method,
            "args": self.args,
            "type": self.type,
            "version": self.version,
        }
        if self.callback_ids:
            result["callbackIds"] = self.callback_ids
        return result


def serialize_message(message: Message) -> str:
    """Serialize a message to a JSON string"""
    return json.dumps(message.to_dict()) + "\n"


def deserialize_message(message_str: str) -> Message:
    """Deserialize a JSON string to a Message object"""
    data = json.loads(message_str)
    return Message(
        id=data["id"],
        method=data["method"],
        args=data["args"],
        type=data["type"],
        callback_ids=data.get("callbackIds"),
        version=data.get("version", "json"),
    )
