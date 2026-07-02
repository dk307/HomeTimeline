"""Integration tests for the locations API."""


def test_list_locations_empty(client):
    r = client.get("/api/v1/locations/")
    assert r.status_code == 200
    assert r.json() == []


def test_create_location(client):
    r = client.post("/api/v1/locations/", json={"name": "Garden", "description": "Back garden"})
    assert r.status_code == 201
    body = r.json()
    assert body["name"] == "Garden"
    assert body["description"] == "Back garden"
    assert "id" in body


def test_create_duplicate_location(client):
    client.post("/api/v1/locations/", json={"name": "Garage"})
    r = client.post("/api/v1/locations/", json={"name": "Garage"})
    assert r.status_code == 409


def test_get_location(client, location):
    r = client.get(f"/api/v1/locations/{location.id}")
    assert r.status_code == 200
    assert r.json()["name"] == location.name


def test_update_location(client, location):
    r = client.patch(f"/api/v1/locations/{location.id}", json={"description": "Updated"})
    assert r.status_code == 200
    assert r.json()["description"] == "Updated"


def test_update_location_not_found(client):
    r = client.patch("/api/v1/locations/9999", json={"name": "Ghost"})
    assert r.status_code == 404


def test_update_location_name(client, location):
    r = client.patch(f"/api/v1/locations/{location.id}", json={"name": "New Name"})
    assert r.status_code == 200
    assert r.json()["name"] == "New Name"


def test_delete_location(client, location):
    r = client.delete(f"/api/v1/locations/{location.id}")
    assert r.status_code == 204
    assert client.get(f"/api/v1/locations/{location.id}").status_code == 404


def test_delete_location_not_found(client):
    r = client.delete("/api/v1/locations/9999")
    assert r.status_code == 404
