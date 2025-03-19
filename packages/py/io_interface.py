from abc import ABC, abstractmethod
from typing import Optional, Union, Dict, Any, List, Callable

class IoInterface(ABC):
    @property
    @abstractmethod
    def name(self) -> str:
        pass
    
    @abstractmethod
    async def read(self) -> Optional[Union[bytes, str]]:
        pass
    
    @abstractmethod
    async def write(self, data: str) -> None:
        pass
