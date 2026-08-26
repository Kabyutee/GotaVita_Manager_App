# Order originating-browser persistence fix

A direct Order mutation can succeed remotely while the originating browser's immediate local snapshot still lacks the new row. The write-through boundary now merges the canonical remote Order collection into local state after every direct Order mutation without deleting local Orders, then refreshes the conflict baseline.