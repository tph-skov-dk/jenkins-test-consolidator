export function deduplicate<T>(
    data: T[],
    cmp: (lhs: T, rhs: T) => boolean,
): T[] {
    return data.reduce((acc: T[], newContender) => {
        if (acc.some((existing) => cmp(existing, newContender))) {
            return acc;
        }
        return [...acc, newContender];
    }, []);
}
