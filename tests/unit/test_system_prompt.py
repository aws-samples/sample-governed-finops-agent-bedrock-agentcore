"""Unit tests for agentcore/system_prompt.py."""

import os
import sys
from pathlib import Path
from unittest.mock import patch

# Add src/recommender to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "src" / "recommender"))

from prompt import (
    _build_available_actions_section,
    build_system_prompt,
    get_current_date_utc,
)


class TestGetCurrentDateUtc:
    """Tests for get_current_date_utc."""

    def test_returns_string(self):
        result = get_current_date_utc()
        assert isinstance(result, str)
        assert result != "unknown"

    def test_format_contains_date(self):
        result = get_current_date_utc()
        # Should contain year-month-day pattern
        assert "-" in result
        assert "UTC" in result


class TestBuildAvailableActionsSection:
    """Tests for _build_available_actions_section."""

    def test_default_actions_when_none(self):
        section = _build_available_actions_section(None)
        assert "resize_instance" in section
        assert "terminate_instance" in section
        assert "AVAILABLE ACTIONS" in section

    def test_dynamic_actions_list(self):
        actions = ["resize_instance", "stop_instance"]
        section = _build_available_actions_section(actions)
        assert "resize_instance" in section
        assert "stop_instance" in section
        # Should NOT include actions not in the list
        assert "delete_ebs_volume" not in section

    def test_unknown_action_gets_generic_description(self):
        actions = ["custom_action"]
        section = _build_available_actions_section(actions)
        assert "custom_action" in section
        assert "dynamically discovered" in section


class TestBuildSystemPrompt:
    """Tests for build_system_prompt."""

    def test_phase_1_base_prompt(self):
        prompt = build_system_prompt(phase=1)
        assert "Cost Optimizer AI assistant" in prompt
        assert "REMEDIATION_OPTIONS" in prompt
        # Should NOT include phase 2+ content
        assert "CloudWatch" not in prompt
        assert "Cedar" not in prompt

    def test_phase_2_includes_cloudwatch(self):
        prompt = build_system_prompt(phase=2)
        assert "CloudWatch" in prompt
        assert "savings" in prompt

    def test_phase_3_includes_authorization(self):
        prompt = build_system_prompt(phase=3)
        assert "Cedar" in prompt
        assert "AUTHORIZATION" in prompt
        assert "Analyst" in prompt

    def test_phase_4_includes_learning(self):
        prompt = build_system_prompt(phase=4)
        assert "LEARNING" in prompt
        assert "record_feedback" in prompt

    def test_account_id_injected(self):
        prompt = build_system_prompt(phase=1)
        # Should contain the default account ID (from env or fallback)
        assert "123456789012" in prompt or os.environ.get("AWS_ACCOUNT_ID", "") in prompt

    @patch.dict(os.environ, {"AWS_ACCOUNT_ID": "999888777666"})
    def test_custom_account_id_from_env(self):
        # Need to reimport to pick up new env var
        import importlib

        import prompt

        importlib.reload(prompt)
        prompt_text = prompt.build_system_prompt(phase=1)
        assert "999888777666" in prompt_text

    def test_available_actions_passed_through(self):
        prompt = build_system_prompt(phase=1, available_actions=["resize_instance"])
        assert "resize_instance" in prompt
        # The AVAILABLE ACTIONS section should only list resize_instance
        section = _build_available_actions_section(["resize_instance"])
        assert "delete_ebs_volume" not in section

    def test_remediation_options_format_documented(self):
        prompt = build_system_prompt(phase=1)
        assert "REMEDIATION_OPTIONS" in prompt
        assert "action_type" in prompt
