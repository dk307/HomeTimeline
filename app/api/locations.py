from fastapi import APIRouter, HTTPException

from app.models.location import Location
from app.schemas.location import LocationCreate, LocationOut, LocationUpdate

router = APIRouter(prefix="/locations", tags=["locations"])


def _to_out(loc: Location) -> LocationOut:
    return LocationOut(
        id=loc.id, name=loc.name, description=loc.description, created_at=loc.created_at
    )


@router.get("", response_model=list[LocationOut])
def list_locations():
    return [_to_out(loc) for loc in Location.select().order_by(Location.name)]


@router.post("", response_model=LocationOut, status_code=201)
def create_location(body: LocationCreate):
    if Location.select().where(Location.name == body.name).exists():
        raise HTTPException(409, f"Location '{body.name}' already exists")
    loc = Location.create(name=body.name, description=body.description)
    return _to_out(loc)


@router.get("/{loc_id}", response_model=LocationOut)
def get_location(loc_id: int):
    loc = Location.get_or_none(Location.id == loc_id)
    if not loc:
        raise HTTPException(404, "Location not found")
    return _to_out(loc)


@router.patch("/{loc_id}", response_model=LocationOut)
def update_location(loc_id: int, body: LocationUpdate):
    loc = Location.get_or_none(Location.id == loc_id)
    if not loc:
        raise HTTPException(404, "Location not found")
    if body.name is not None:
        loc.name = body.name
    if body.description is not None:
        loc.description = body.description
    loc.save()
    return _to_out(loc)


@router.delete("/{loc_id}", status_code=204)
def delete_location(loc_id: int):
    loc = Location.get_or_none(Location.id == loc_id)
    if not loc:
        raise HTTPException(404, "Location not found")
    loc.delete_instance()
