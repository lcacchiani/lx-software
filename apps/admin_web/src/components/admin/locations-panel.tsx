'use client';

import { useEffect, useState } from 'react';

import {
  ApiError,
  createResource,
  deleteResource,
  listResource,
  updateResource,
} from '../../lib/api-client';
import type { Location, Organization } from '../../types/admin';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select } from '../ui/select';
import { StatusBanner } from '../status-banner';

const emptyForm = {
  org_id: '',
  district: '',
  address: '',
  lat: '',
  lng: '',
};

function parseOptionalNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function LocationsPanel() {
  const [items, setItems] = useState<Location[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [formState, setFormState] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);

  const loadOrganizations = async () => {
    try {
      const response = await listResource<Organization>(
        'organizations',
        undefined,
        200
      );
      setOrganizations(response.items);
    } catch {
      setOrganizations([]);
    }
  };

  const loadItems = async (cursor?: string) => {
    setIsLoading(true);
    setError('');
    try {
      const response = await listResource<Location>('locations', cursor);
      setItems((prev) =>
        cursor ? [...prev, ...response.items] : response.items
      );
      setNextCursor(response.next_cursor ?? null);
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to load locations.';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadItems();
    loadOrganizations();
  }, []);

  const resetForm = () => {
    setFormState(emptyForm);
    setEditingId(null);
  };

  const handleSubmit = async () => {
    if (!formState.org_id || !formState.district.trim()) {
      setError('Organization and district are required.');
      return;
    }
    setIsSaving(true);
    setError('');
    try {
      const payload = {
        org_id: formState.org_id,
        district: formState.district.trim(),
        address: formState.address.trim() || null,
        lat: parseOptionalNumber(formState.lat),
        lng: parseOptionalNumber(formState.lng),
      };
      if (editingId) {
        const updated = await updateResource<typeof payload, Location>(
          'locations',
          editingId,
          payload
        );
        setItems((prev) =>
          prev.map((item) => (item.id === editingId ? updated : item))
        );
      } else {
        const created = await createResource<typeof payload, Location>(
          'locations',
          payload
        );
        setItems((prev) => [created, ...prev]);
      }
      resetForm();
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Unable to save location.';
      setError(message);
    } finally {
      setIsSaving(false);
    }
  };

  const startEdit = (item: Location) => {
    setEditingId(item.id);
    setFormState({
      org_id: item.org_id ?? '',
      district: item.district ?? '',
      address: item.address ?? '',
      lat:
        item.lat !== undefined && item.lat !== null ? `${item.lat}` : '',
      lng:
        item.lng !== undefined && item.lng !== null ? `${item.lng}` : '',
    });
  };

  const handleDelete = async (item: Location) => {
    const confirmed = window.confirm(
      `Delete location ${item.district}? This cannot be undone.`
    );
    if (!confirmed) {
      return;
    }
    setError('');
    try {
      await deleteResource('locations', item.id);
      setItems((prev) => prev.filter((entry) => entry.id !== item.id));
      if (editingId === item.id) {
        resetForm();
      }
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Unable to delete location.';
      setError(message);
    }
  };

  return (
    <div className='space-y-6'>
      <Card title='Locations' description='Manage location entries.'>
        {error && (
          <div className='mb-4'>
            <StatusBanner variant='error' title='Error'>
              {error}
            </StatusBanner>
          </div>
        )}
        <div className='grid gap-4 md:grid-cols-2'>
          <div>
            <Label htmlFor='location-org'>Organization</Label>
            <Select
              id='location-org'
              value={formState.org_id}
              onChange={(event) =>
                setFormState((prev) => ({
                  ...prev,
                  org_id: event.target.value,
                }))
              }
            >
              <option value=''>Select organization</option>
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor='location-district'>District</Label>
            <Input
              id='location-district'
              value={formState.district}
              onChange={(event) =>
                setFormState((prev) => ({
                  ...prev,
                  district: event.target.value,
                }))
              }
            />
          </div>
          <div className='md:col-span-2'>
            <Label htmlFor='location-address'>Address</Label>
            <Input
              id='location-address'
              value={formState.address}
              onChange={(event) =>
                setFormState((prev) => ({
                  ...prev,
                  address: event.target.value,
                }))
              }
            />
          </div>
          <div>
            <Label htmlFor='location-lat'>Latitude</Label>
            <Input
              id='location-lat'
              type='number'
              step='0.000001'
              value={formState.lat}
              onChange={(event) =>
                setFormState((prev) => ({
                  ...prev,
                  lat: event.target.value,
                }))
              }
            />
          </div>
          <div>
            <Label htmlFor='location-lng'>Longitude</Label>
            <Input
              id='location-lng'
              type='number'
              step='0.000001'
              value={formState.lng}
              onChange={(event) =>
                setFormState((prev) => ({
                  ...prev,
                  lng: event.target.value,
                }))
              }
            />
          </div>
        </div>
        <div className='mt-4 flex flex-wrap gap-3'>
          <Button type='button' onClick={handleSubmit} disabled={isSaving}>
            {editingId ? 'Update location' : 'Add location'}
          </Button>
          {editingId && (
            <Button
              type='button'
              variant='secondary'
              onClick={resetForm}
              disabled={isSaving}
            >
              Cancel edit
            </Button>
          )}
        </div>
      </Card>
      <Card
        title='Existing locations'
        description='Select a location to edit or delete.'
      >
        {isLoading ? (
          <p className='text-sm text-slate-600'>Loading locations...</p>
        ) : items.length === 0 ? (
          <p className='text-sm text-slate-600'>No locations yet.</p>
        ) : (
          <div className='overflow-x-auto'>
            <table className='w-full text-left text-sm'>
              <thead className='border-b border-slate-200 text-slate-500'>
                <tr>
                  <th className='py-2'>District</th>
                  <th className='py-2'>Organization</th>
                  <th className='py-2'>Address</th>
                  <th className='py-2 text-right'>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.id}
                    className='border-b border-slate-100'
                  >
                    <td className='py-2 font-medium'>{item.district}</td>
                    <td className='py-2 text-slate-600'>
                      {organizations.find((org) => org.id === item.org_id)
                        ?.name || item.org_id}
                    </td>
                    <td className='py-2 text-slate-600'>
                      {item.address || '—'}
                    </td>
                    <td className='py-2 text-right'>
                      <div className='flex justify-end gap-2'>
                        <Button
                          type='button'
                          size='sm'
                          variant='secondary'
                          onClick={() => startEdit(item)}
                        >
                          Edit
                        </Button>
                        <Button
                          type='button'
                          size='sm'
                          variant='danger'
                          onClick={() => handleDelete(item)}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {nextCursor && (
              <div className='mt-4'>
                <Button
                  type='button'
                  variant='secondary'
                  onClick={() => loadItems(nextCursor)}
                >
                  Load more
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
