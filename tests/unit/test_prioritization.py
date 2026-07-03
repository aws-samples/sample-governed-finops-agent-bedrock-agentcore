"""Unit tests for agentcore/tools/prioritization.py."""

import sys
from pathlib import Path

# Add src/recommender to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "src" / "recommender"))

from models import Recommendation, UserPreferences
from tools.prioritization import prioritize_recommendations


def _make_rec(id, savings, risk_level="low", category="rightsizing"):
    return Recommendation(
        id=id,
        source="test",
        category=category,
        resource_id=f"i-{id}",
        resource_type="ec2:instance",
        current_cost=100.0,
        estimated_savings=savings,
        risk_level=risk_level,
        action="resize_instance",
    )


class TestPrioritization:
    """Tests for the prioritize_recommendations function."""

    def test_empty_list(self):
        result = prioritize_recommendations([])
        assert result == []

    def test_single_recommendation(self):
        recs = [_make_rec("1", 50.0)]
        result = prioritize_recommendations(recs)
        assert len(result) == 1
        assert result[0].priority_score > 0

    def test_higher_savings_ranked_first(self):
        recs = [
            _make_rec("low", 10.0),
            _make_rec("high", 90.0),
            _make_rec("mid", 50.0),
        ]
        result = prioritize_recommendations(recs)
        assert result[0].id == "high"
        assert result[-1].id == "low"

    def test_low_risk_preferred_over_high_risk(self):
        """Same savings, low risk should rank higher."""
        recs = [
            _make_rec("high-risk", 50.0, risk_level="high"),
            _make_rec("low-risk", 50.0, risk_level="low"),
        ]
        result = prioritize_recommendations(recs)
        assert result[0].id == "low-risk"

    def test_priority_scores_between_0_and_1(self):
        recs = [
            _make_rec("1", 10.0, "low"),
            _make_rec("2", 50.0, "medium"),
            _make_rec("3", 90.0, "high"),
        ]
        result = prioritize_recommendations(recs)
        for rec in result:
            assert 0.0 <= rec.priority_score <= 1.0

    def test_user_preferences_boost_accepted(self):
        """Accepted categories should get higher scores."""
        prefs = UserPreferences(
            user_id="user-1",
            accepted_categories={"rightsizing": 5},
            rejected_categories={"idle_resources": 3},
        )
        recs = [
            _make_rec("idle", 50.0, category="idle_resources"),
            _make_rec("right", 50.0, category="rightsizing"),
        ]
        result = prioritize_recommendations(recs, user_preferences=prefs)
        assert result[0].id == "right"

    def test_user_preferences_penalize_rejected(self):
        """Rejected categories should get lower scores."""
        prefs = UserPreferences(
            user_id="user-1",
            accepted_categories={},
            rejected_categories={"rightsizing": 10},
        )
        recs = [
            _make_rec("rejected", 50.0, category="rightsizing"),
            _make_rec("neutral", 50.0, category="idle_resources"),
        ]
        result = prioritize_recommendations(recs, user_preferences=prefs)
        assert result[0].id == "neutral"

    def test_all_zero_savings(self):
        """Should not crash when all savings are zero."""
        recs = [
            _make_rec("1", 0.0),
            _make_rec("2", 0.0),
        ]
        result = prioritize_recommendations(recs)
        assert len(result) == 2
        for rec in result:
            assert rec.priority_score >= 0
