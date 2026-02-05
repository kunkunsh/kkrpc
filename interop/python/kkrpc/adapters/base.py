from abc import ABC, abstractmethod
from typing import Optional


class Transport(ABC):
	@abstractmethod
	def read(self) -> Optional[str]:
		raise NotImplementedError

	@abstractmethod
	def write(self, message: str) -> None:
		raise NotImplementedError

	@abstractmethod
	def close(self) -> None:
		raise NotImplementedError
