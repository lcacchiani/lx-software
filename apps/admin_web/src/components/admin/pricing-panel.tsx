'use client';

import { useEffect, useState } from 'react';

import {
  ApiError,
  createResource,
  deleteResource,
  listResource,
  updateResource,
} from '../../lib/api-client';
import type { Activity, ActivityPricing, Location } from '../../types/admin';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select } from '../ui/select';
import { StatusBanner } from '../status-banner';

const emptyForm = {
  activity_id: '',
  location_id: '',
  pricing_type: 'per_class',
  amount: '',
  currency: 'HKD',
  sessions_count: '',
};

const pricingOptions = [
  { value: 'per_class', label: 'Per class' },
  { value: 'per_month', label: 'Per month' },
  { value: 'per_sessions', label: 'Per sessions' },
];

function parseOptionalNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function PricingPanel() {
  const [items, setItems] = useState<ActivityPricing[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [formState, setFormState] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);

  const loadReferences = async () => {
    try {
      const [activitiesResponse, locationsResponse] = await Promise.all([
        listResource<Activity>('activities', undefined, 200),
        listResource<Location>('locations', undefined, 200),
      ]);
      setActivities(activitiesResponse.items);
      setLocations(locationsResponse.items);
    } catch {
      setActivities([]);
      setLocations([]);
    }
  };

  const loadItems = async (cursor?: string) => {
    setIsLoading(true);
    setError('');
    try {
      const response = await listResource<ActivityPricing>('pricing', cursor);
      setItems((prev) =>
        cursor ? [...prev, ...response.items] : response.items
      );
      setNextCursor(response.next_cursor ?? null);
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to load pricing.';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadItems();
    loadReferences();
  }, []);

  const resetForm = () => {
    setFormState(emptyForm);
    setEditingId(null);
  };

  const handleSubmit = async () => {
    if (!formState.activity_id || !formState.location_id) {
      setError('Activity and location are required.');
      return;
    }
    if (!formState.amount.trim()) {
      setError('Amount is required.');
      return;
    }
    const amountValue = Number(formState.amount);
    if (!Number.isFinite(amountValue)) {
      setError('Amount must be numeric.');
      return;
    }
    const sessionsCount = parseOptionalNumber(formState.sessions_count);
    if (formState.pricing_type === 'per_sessions') {
      if (sessionsCount === null || sessionsCount <= 0) {
        setError('Sessions count is required for per-sessions pricing.');
        return;
      }
    }
    setIsSaving(true);
    setError('');
    try {
      const payload = {
        activity_id: formState.activity_id,
        location_id: formState.location_id,
        pricing_type: formState.pricing_type,
        amount: formState.amount.trim(),
        currency: formState.currency.trim() || 'HKD',
        sessions_count:
          formState.pricing_type === 'per_sessions'
            ? sessionsCount
            : null,
      };
      if (editingId) {
        const updated = await updateResource<typeof payload, ActivityPricing>(
          'pricing',
          editingId,
          payload
        );
        setItems((prev) =>
          prev.map((item) => (item.id === editingId ? updated : item))
        );
      } else {
        const created = await createResource<typeof payload, ActivityPricing>(
          'pricing',
          payload
        );
        setItems((prev) => [created, ...prev]);
      }
      resetForm();
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Unable to save pricing.';
      setError(message);
    } finally {
      setIsSaving(false);
    }
  };

  const startEdit = (item: ActivityPricing) => {
    setEditingId(item.id);
    setFormState({
      activity_id: item.activity_id ?? '',
      location_id: item.location_id ?? '',
      pricing_type: item.pricing_type,
      amount: item.amount ?? '',
      currency: item.currency ?? 'HKD',
      sessions_count: item.sessions_count ? `${item.sessions_count}` : '',
    });
  };

  const handleDelete = async (item: ActivityPricing) => {
    const confirmed = window.confirm(
      'Delete this pricing entry? This cannot be undone.'
    );
    if (!confirmed) {
      return;
    }
    setError('');
    try {
      await deleteResource('pricing', item.id);
      setItems((prev) => prev.filter((entry) => entry.id !== item.id));
      if (editingId === item.id) {
        resetForm();
      }
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Unable to delete pricing.';
      setError(message);
    }
  };

  const showSessionsField = formState.pricing_type === 'per_sessions';

  return (
    <div className='space-y-6'>
      <Card title='Pricing' description='Manage pricing entries.'>
        {error && (
          <div className='mb-4'>
            <StatusBanner variant='error' title='Error'>
              {error}
            </StatusBanner>
          </div>
        )}
        <div className='grid gap-4 md:grid-cols-2'>
          <div>
            <Label htmlFor='pricing-activity'>Activity</Label>
            <Select
              id='pricing-activity'
              value={formState.activity_id}
              onChange={(event) =>
                setFormState((prev) => ({
                  ...prev,
                  activity_id: event.target.value,
                }))
              }
            >
              <option value=''>Select activity</option>
              {activities.map((activity) => (
                <option key={activity.id} value={activity.id}>
                  {activity.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor='pricing-location'>Location</Label>
            <Select
              id='pricing-location'
              value={formState.location_id}
              onChange={(event) =>
                setFormState((prev) => ({
                  ...prev,
                  location_id: event.target.value,
                }))
              }
            >
              <option value=''>Select location</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.district}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor='pricing-type'>Pricing type</Label>
            <Select
              id='pricing-type'
              value={formState.pricing_type}
              onChange={(event) =>
                setFormState((prev) => ({
                  ...prev,
                  pricing_type: event.target.value,
                  sessions_count:
                    event.target.value === 'per_sessions'
                      ? prev.sessions_count
                      : '',
                }))
              }
            >
              {pricingOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor='pricing-amount'>Amount</Label>
            <Input
              id='pricing-amount'
              type='number'
              step='0.01'
              value={formState.amount}
              onChange={(event) =>
                setFormState((prev) => ({
                  ...prev,
                  amount: event.target.value,
                }))
              }
            />
          </div>
          <div>
            <Label htmlFor='pricing-currency'>Currency</Label>
            <Input
              id='pricing-currency'
              value={formState.currency}
              onChange={(event) =>
                setFormState((prev) => ({
                  ...prev,
                  currency: event.target.value,
                }))
              }
            />
          </div>
          {showSessionsField && (
            <div>
              <Label htmlFor='pricing-sessions'>Sessions count</Label>
              <Input
                id='pricing-sessions'
                type='number'
                min='1'
                value={formState.sessions_count}
                onChange={(event) =>
                  setFormState((prev) => ({
                    ...prev,
                    sessions_count: event.target.value,
                  }))
                }
              />
            </div>
          )}
        </div>
        <div className='mt-4 flex flex-wrap gap-3'>
          <Button type='button' onClick={handleSubmit} disabled={isSaving}>
            {editingId ? 'Update pricing' : 'Add pricing'}
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
        title='Existing pricing'
        description='Select a pricing entry to edit or delete.'
      >
        {isLoading ? (
          <p className='text-sm text-slate-600'>Loading pricing...</p>
        ) : items.length === 0 ? (
          <p className='text-sm text-slate-600'>No pricing entries yet.</p>
        ) : (
          <div className='overflow-x-auto'>
            <table className='w-full text-left text-sm'>
              <thead className='border-b border-slate-200 text-slate-500'>
                <tr>
                  <th className='py-2'>Activity</th>
                  <th className='py-2'>Location</th>
                  <th className='py-2'>Type</th>
                  <th className='py-2'>Amount</th>
                  <th className='py-2 text-right'>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const activityName =
                    activities.find(
                      (activity) => activity.id === item.activity_id
                    )?.name || item.activity_id;
                  const locationName =
                    locations.find(
                      (location) => location.id === item.location_id
                    )?.district || item.location_id;
                  return (
                    <tr
                      key={item.id}
                      className='border-b border-slate-100'
                    >
                      <td className='py-2 font-medium'>{activityName}</td>
                      <td className='py-2 text-slate-600'>{locationName}</td>
                      <td className='py-2 text-slate-600'>
                        {item.pricing_type}
                      </td>
                      <td className='py-2 text-slate-600'>
                        {item.amount} {item.currency}
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
                  );
                })}
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
