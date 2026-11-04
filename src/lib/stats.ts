import type { AlbumStatus } from '../../shared/types'

type ByStatus = Partial<Record<AlbumStatus, number>>

/** Albums waiting on a decision from the user. */
export const needsReview = (s: ByStatus) => (s.review ?? 0) + (s.unmatched ?? 0)

/** Albums the next apply will organize. */
export const readyToOrganize = (s: ByStatus) => (s.matched ?? 0) + (s.accepted ?? 0) + (s.singles ?? 0) + (s.duplicate ?? 0)
