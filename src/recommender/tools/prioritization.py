"""Recommendation prioritization engine.

Sorts optimization recommendations by estimated savings, risk level,
and optionally user preferences (Phase 4).
"""

from __future__ import annotations

from models import Recommendation, UserPreferences


def prioritize_recommendations(
    recommendations: list[Recommendation],
    user_preferences: UserPreferences | None = None,
) -> list[Recommendation]:
    """Prioritize recommendations by savings, risk, and user preferences.

    Formula: 50% normalized savings + 30% risk factor + 20% preference score.
    Risk multipliers: low=1.0, medium=0.7, high=0.4.

    Returns the same list sorted by priority_score descending.
    """
    if not recommendations:
        return []

    max_savings = max(r.estimated_savings for r in recommendations)
    if max_savings == 0:
        max_savings = 1.0

    risk_multiplier = {"low": 1.0, "medium": 0.7, "high": 0.4}

    for rec in recommendations:
        savings_score = rec.estimated_savings / max_savings
        risk_score = risk_multiplier.get(rec.risk_level, 0.5)

        preference_score = 1.0
        if user_preferences:
            accepted = user_preferences.accepted_categories.get(rec.category, 0)
            rejected = user_preferences.rejected_categories.get(rec.category, 0)
            total = accepted + rejected
            if total > 0:
                preference_score = 0.5 + 0.5 * (accepted - rejected) / total

        rec.priority_score = round(
            0.5 * savings_score + 0.3 * risk_score + 0.2 * preference_score,
            4,
        )

    recommendations.sort(key=lambda r: r.priority_score, reverse=True)
    return recommendations
