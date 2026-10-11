import unittest
from unittest.mock import patch
import server

class ContextBudgetTests(unittest.TestCase):
    def test_output_and_oversized_prompt_are_rejected_before_service_access(self):
        with patch.object(server,'RUNTIME_MODE','live'), patch.object(server,'proxy_json') as proxy:
            client=server.app.test_client()
            base={'model':'fixture','messages':[{'role':'user','content':'hello'}]}
            for payload in ({**base,'max_tokens':server.budget.OUTPUT_RESERVE+1}, {**base,'messages':[{'role':'user','content':'🌸'*server.budget.CONTEXT_CAPACITY}]}):
                result=client.post('/chat',json=payload)
                self.assertEqual(result.status_code,400)
                self.assertIn('error',result.json)
            proxy.assert_not_called()
    def test_default_reserve_and_template_padding_are_applied(self):
        payload={'messages':[{'role':'system','content':'profile'},{'role':'user','content':'hi'}]}
        checked=server.budget.enforce_budget(payload)
        self.assertEqual(checked['max_tokens'],server.budget.OUTPUT_RESERVE)
