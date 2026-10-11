"""Conservative text-only byte-token budget; never contacts a tokenizer/model."""
from service_contracts import ServiceError
import unicodedata
from config import CONTEXT_CAPACITY, OUTPUT_RESERVE, PROFILE_BUDGET, MEMORY_BUDGET, TEMPLATE_RESERVE, MESSAGE_OVERHEAD


def public_config():
    return {'capacity':CONTEXT_CAPACITY,'outputReserve':OUTPUT_RESERVE,'profileBudget':PROFILE_BUDGET,'memoryBudget':MEMORY_BUDGET,'templateReserve':TEMPLATE_RESERVE,'messageOverhead':MESSAGE_OVERHEAD}


def enforce_budget(payload):
    requested = payload.get('max_tokens',OUTPUT_RESERVE)
    if requested > OUTPUT_RESERVE:
        raise ServiceError('Requested output exceeds the configured reply reserve.',400)
    prompt_bound = sum(len(unicodedata.normalize('NFC',message['content']).encode('utf-8')) + MESSAGE_OVERHEAD for message in payload['messages']) + TEMPLATE_RESERVE
    if prompt_bound + requested > CONTEXT_CAPACITY:
        raise ServiceError('Conversation exceeds the configured context budget. Shorten the message or increase the configured capacity.',400)
    payload['max_tokens'] = requested
    return payload
