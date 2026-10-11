"""Conservative text-only byte-token budget; never contacts a tokenizer/model."""
from service_contracts import ServiceError
import os
import unicodedata

CONTEXT_CAPACITY = int(os.environ.get('ASENA_CONTEXT_CAPACITY','8192'))
OUTPUT_RESERVE = int(os.environ.get('ASENA_OUTPUT_RESERVE','512'))
PROFILE_BUDGET = int(os.environ.get('ASENA_PROFILE_BUDGET','4096'))
MEMORY_BUDGET = int(os.environ.get('ASENA_MEMORY_BUDGET','1024'))
TEMPLATE_RESERVE = 256
MESSAGE_OVERHEAD = 64

if min(CONTEXT_CAPACITY,OUTPUT_RESERVE,PROFILE_BUDGET,MEMORY_BUDGET) <= 0 or OUTPUT_RESERVE + TEMPLATE_RESERVE >= CONTEXT_CAPACITY:
    raise RuntimeError('Invalid conversation budget configuration')


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
