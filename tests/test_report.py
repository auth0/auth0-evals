import report


def test_grade_color_perfect():
    assert report.grade_color(1.0) == "#22c55e"
