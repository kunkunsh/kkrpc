from typing import IO, Optional

from .base import Transport


class StdioTransport(Transport):
    def __init__(self, reader: IO[str], writer: IO[str]) -> None:
        self._reader = reader
        self._writer = writer

    def read(self) -> Optional[str]:
        line = self._reader.readline()
        if line == "":
            return None
        return line.strip()

    def write(self, message: str) -> None:
        self._writer.write(message)
        self._writer.flush()

    def close(self) -> None:
        try:
            self._writer.close()
        except OSError:
            pass
