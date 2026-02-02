'use client';

import { useEffect, useState } from 'react';

import {
  ApiError,
  createResource,
  deleteResource,
  listResource,
  updateResource,
} from '../../lib/api-client';
import type { Activity, Organization } from '../../types/admin';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select } from '../ui/select';
import { Textarea } from '../ui/textarea';
import { StatusBanner } from '../status-banner';

const emptyForm = {
  org_id: '',
  name: '',
  description: '',
  age_min: '',
  age_max: '',
};

function parseRequiredNumber(value: string) {
  const trimmed = value.trim();
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function ActivitiesPanel() {
  const [items, setItems] = useState<Activity[]>([]);
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
      const response = await listResource<Activity>('activities', cursor);
      setItems((prev) =>
        cursor ? [...prev, ...response.items] : response.items
      );
      setNextCursor(response.next_cursor ?? null);
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to load activities.';
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
    const ageMin = parseRequiredNumber(formState.age_min);
    const ageMax = parseRequiredNumber(formState.age_max);
    if (!formState.org_id || !formState.name.trim()) {
      setError('Organization and name are required.');
      return;
    }
    if (ageMin === null || ageMax === null) {
      setError('Age range must be numeric.');
      return;
    }
    if (ageMin >= ageMax) {
      setError('Age min must be less than age max.');
      return;
    }
    setIsSaving(true);
    setError('');
    try {
      const payload = {
        org_id: formState.org_id,
        name: formState.name.trim(),
        description: formState.description.trim() || null,
        age_min: ageMin,
        age_max: ageMax,
      };
      if (editingId) {
        const updated = await updateResource<typeof payload, Activity>(
          'activities',
          editingId,
          payload
        );
        setItems((prev) =>
          prev.map((item) => (item.id === editingId ? updated : item))
        );
      } else {
        const created = await createResource<typeof payload, Activity>(
          'activities',
          payload
        );
        setItems((prev) => [created, ...prev]);
      }
      resetForm();
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Unable to save activity.';
      setError(message);
    } finally {
      setIsSaving(false);
    }
  };

  const startEdit = (item: Activity) => {
    setEditingId(item.id);
    setFormState({
      org_id: item.org_id ?? '',
      name: item.name ?? '',
      description: item.description ?? '',
      age_min: item.age_min !== undefined ? `${item.age_min}` : '',
      age_max: item.age_max !== undefined ? `${item.age_max}` : '',
    });
  };

  const handleDelete = async (item: Activity) => {
    const confirmed = window.confirm(
      `Delete activity ${item.name}? This cannot be undone.`
    );
    if (!confirmed) {
      return;
    }
    setError('');
    try {
      await deleteResource('activities', item.id);
      setItems((prev) => prev.filter((entry) => entry.id !== item.id));
      if (editingId === item.id) {
        resetForm();
      }
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Unable to delete activity.';
      setError(message);
    }
  };

  return (
    <div className='space-y-6'>
      <Card title='Activities' description='Manage activity entries.'>
        {error && (
          <div className='mb-4'>
            <StatusBanner variant='error' title='Error'>
              {error}
            </StatusBanner>
          </div>
        )}
        <div className='grid gap-4 md:grid-cols-2'>
          <div>
            <Label htmlFor='activity-org'>Organization</Label>
            <Select
              id='activity-org'
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
            <Label htmlFor='activity-name'>Name</Label>
            <Input
              id='activity-name'
              value={formState.name}
              onChange={(event) =>
                setFormState((prev) => ({
                  ...prev,
                  name: event.target.value,
                }))
              }
            />
          </div>
          <div className='md:col-span-2'>
            <Label htmlFor='activity-description'>Description</Label>
            <Textarea
              id='activity-description'
              rows={3}
              value={formState.description}
              onChange={(event) =>
                setFormState((prev) => ({
                  ...prev,
                  description: event.target.value,
                }))
              }
            />
          </div>
          <div>
            <Label htmlFor='activity-age-min'>Age min</Label>
            <Input
              id='activity-age-min'
              type='number'
              min='0'
              value={formState.age_min}
              onChange={(event) =>
                setFormState((prev) => ({
                  ...prev,
                  age_min: event.target.value,
                }))
              }
            />
          </div>
          <div>
            <Label htmlFor='activity-age-max'>Age max</Label>
            <Input
              id='activity-age-max'
              type='number'
              min='0'
              value={formState.age_max}
              onChange={(event) =>
                setFormState((prev) => ({
                  ...prev,
                  age_max: event.target.value,
                }))
              }
            />
          </div>
        </div>
        <div className='mt-4 flex flex-wrap gap-3'>
          <Button type='button' onClick={handleSubmit} disabled={isSaving}>
            {editingId ? 'Update activity' : 'Add activity'}
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
        title='Existing activities'
        description='Select an activity to edit or delete.'
      >
        {isLoading ? (
          <p className='text-sm text-slate-600'>Loading activities...</p>
        ) : items.length === 0 ? (
          <p className='text-sm text-slate-600'>No activities yet.</p>
        ) : (
          <div className='overflow-x-auto'>
            <table className='w-full text-left text-sm'>
              <thead className='border-b border-slate-200 text-slate-500'>
                <tr>
                  <th className='py-2'>Name</th>
                  <th className='py-2'>Organization</th>
                  <th className='py-2'>Age range</th>
                  <th className='py-2 text-right'>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.id}
                    className='border-b border-slate-100'
                  >
                    <td className='py-2 font-medium'>{item.name}</td>
                    <td className='py-2 text-slate-600'>
                      {organizations.find((org) => org.id === item.org_id)
                        ?.name || item.org_id}
                    </td>
                    <td className='py-2 text-slate-600'>
                      {item.age_min} - {item.age_max}
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
