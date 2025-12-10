# Weft TODO

## Bugs

### Work cancel sets status to 'failed' instead of 'cancelled'

**Location**: `src/service.ts:581-585`

**Problem**: The NATS `coord.*.work.cancel` handler uses `recordError()` to cancel work items, which sets the status to `failed` instead of `cancelled`.

```typescript
// Current implementation
nc.subscribe('coord.*.work.cancel', {
  callback: handleWithProject(async (context, { id }) => {
    await context.coordinator.recordError(id, 'Cancelled by user', false);
    return { success: true };
  }),
});
```

**Expected behavior**: Cancelled work items should have status `cancelled`, not `failed`.

**Suggested fix**: Add a proper `cancelWorkItem()` method to the coordinator that sets status to `cancelled` rather than reusing `recordError()`.

## Enhancements

(none currently)
