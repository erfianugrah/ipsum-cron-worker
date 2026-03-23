import { describe, expect, it } from 'vitest';
import { ALL_LEVELS, LIST_NAME_PREFIX, MAX_LEVEL, MIN_LEVEL, listDescriptionForLevel, listNameForLevel, parseLevels } from '../src/consts';

describe('consts', () => {
	it('ALL_LEVELS contains 1 through 8', () => {
		expect(ALL_LEVELS).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
	});

	it('MIN_LEVEL and MAX_LEVEL bound ALL_LEVELS', () => {
		expect(MIN_LEVEL).toBe(ALL_LEVELS[0]);
		expect(MAX_LEVEL).toBe(ALL_LEVELS[ALL_LEVELS.length - 1]);
	});

	describe('listNameForLevel', () => {
		it('generates valid CF list names (lowercase, underscores)', () => {
			for (const level of ALL_LEVELS) {
				const name = listNameForLevel(level);
				expect(name).toMatch(/^[a-z0-9_]+$/);
				expect(name.length).toBeLessThanOrEqual(50);
				expect(name).toBe(`${LIST_NAME_PREFIX}${level}`);
			}
		});
	});

	describe('listDescriptionForLevel', () => {
		it('includes the level number and ipsum URL', () => {
			const desc = listDescriptionForLevel(3);
			expect(desc).toContain('3+');
			expect(desc).toContain('github.com/stamparm/ipsum');
		});

		it('is within CF 500 char description limit', () => {
			for (const level of ALL_LEVELS) {
				expect(listDescriptionForLevel(level).length).toBeLessThanOrEqual(500);
			}
		});
	});

	describe('parseLevels', () => {
		it('returns ALL_LEVELS when undefined', () => {
			expect(parseLevels(undefined)).toEqual([...ALL_LEVELS]);
		});

		it('returns ALL_LEVELS when empty string', () => {
			expect(parseLevels('')).toEqual([...ALL_LEVELS]);
		});

		it('parses comma-separated levels', () => {
			expect(parseLevels('3,4,5')).toEqual([3, 4, 5]);
		});

		it('trims whitespace', () => {
			expect(parseLevels(' 3 , 5 , 7 ')).toEqual([3, 5, 7]);
		});

		it('deduplicates and sorts', () => {
			expect(parseLevels('5,3,5,7,3')).toEqual([3, 5, 7]);
		});

		it('filters out-of-range values', () => {
			expect(parseLevels('0,1,9,8')).toEqual([1, 8]);
		});

		it('returns ALL_LEVELS when all values are invalid', () => {
			expect(parseLevels('0,9,abc')).toEqual([...ALL_LEVELS]);
		});

		it('handles single level', () => {
			expect(parseLevels('6')).toEqual([6]);
		});
	});
});
