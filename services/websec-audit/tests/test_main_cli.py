"""Tests for main.py CLI argument parsing (the --workers auto/int handling)."""

import argparse

import pytest

import main
from core.audit import AUTO_WORKERS


@pytest.mark.parametrize("value", ["auto", "AUTO", "max", " Max "])
def test_workers_arg_auto_aliases(value):
    assert main._workers_arg(value) == AUTO_WORKERS


@pytest.mark.parametrize("value,expected", [("1", 1), ("20", 20), ("0", 0), ("-3", -3)])
def test_workers_arg_integers(value, expected):
    assert main._workers_arg(value) == expected


def test_workers_arg_rejects_garbage():
    with pytest.raises(argparse.ArgumentTypeError):
        main._workers_arg("lots")
