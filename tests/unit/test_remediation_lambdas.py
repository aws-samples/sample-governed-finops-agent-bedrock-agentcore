"""Unit tests for lambda/remediation/ handlers."""

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

# Add lambda/remediation to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "lambda" / "remediation"))


class TestResizeInstance:
    """Tests for resize_instance Lambda."""

    @patch("resize_instance.ec2")
    def test_missing_resource_id(self, mock_ec2):
        from resize_instance import handler

        result = handler({"target_type": "t3.small"}, None)
        assert result["success"] is False
        assert "required" in result["error"]

    @patch("resize_instance.ec2")
    def test_missing_target_type(self, mock_ec2):
        from resize_instance import handler

        result = handler({"resource_id": "i-0abc123"}, None)
        assert result["success"] is False
        assert "required" in result["error"]

    @patch("resize_instance.ec2")
    def test_already_target_type(self, mock_ec2):
        from resize_instance import handler

        mock_ec2.describe_instances.return_value = {
            "Reservations": [
                {
                    "Instances": [
                        {
                            "InstanceType": "t3.small",
                            "State": {"Name": "running"},
                        }
                    ]
                }
            ]
        }
        result = handler({"resource_id": "i-0abc123", "target_type": "t3.small"}, None)
        assert result["success"] is True
        assert result["message"] == "Already the target type"

    @patch("resize_instance.ec2")
    def test_successful_resize(self, mock_ec2):
        from resize_instance import handler

        # First describe: running, m5.xlarge
        # Second describe (after resize): t3.small
        mock_ec2.describe_instances.side_effect = [
            {"Reservations": [{"Instances": [{"InstanceType": "m5.xlarge", "State": {"Name": "running"}}]}]},
            {"Reservations": [{"Instances": [{"InstanceType": "t3.small", "State": {"Name": "running"}}]}]},
        ]
        mock_ec2.get_waiter.return_value = MagicMock()

        result = handler({"resource_id": "i-0abc123", "target_type": "t3.small"}, None)
        assert result["success"] is True
        assert result["previous_type"] == "m5.xlarge"
        assert result["current_type"] == "t3.small"
        mock_ec2.stop_instances.assert_called_once()
        mock_ec2.modify_instance_attribute.assert_called_once()
        mock_ec2.start_instances.assert_called_once()

    @patch("resize_instance.ec2")
    def test_resize_exception(self, mock_ec2):
        from resize_instance import handler

        mock_ec2.describe_instances.side_effect = Exception("API Error")
        result = handler({"resource_id": "i-0abc123", "target_type": "t3.small"}, None)
        assert result["success"] is False
        assert "API Error" in result["error"]


class TestStopInstance:
    """Tests for stop_instance Lambda."""

    @patch("stop_instance.ec2")
    def test_missing_resource_id(self, mock_ec2):
        from stop_instance import handler

        result = handler({}, None)
        assert result["success"] is False
        assert "required" in result["error"]

    @patch("stop_instance.ec2")
    def test_instance_not_running(self, mock_ec2):
        from stop_instance import handler

        mock_ec2.describe_instances.return_value = {"Reservations": [{"Instances": [{"State": {"Name": "stopped"}}]}]}
        result = handler({"resource_id": "i-0abc123"}, None)
        assert result["success"] is False
        assert "not running" in result["error"]

    @patch("stop_instance.ec2")
    def test_successful_stop(self, mock_ec2):
        from stop_instance import handler

        mock_ec2.describe_instances.side_effect = [
            {"Reservations": [{"Instances": [{"State": {"Name": "running"}}]}]},
            {"Reservations": [{"Instances": [{"State": {"Name": "stopped"}}]}]},
        ]
        mock_ec2.get_waiter.return_value = MagicMock()

        result = handler({"resource_id": "i-0abc123"}, None)
        assert result["success"] is True
        assert result["previous_state"] == "running"
        assert result["current_state"] == "stopped"
