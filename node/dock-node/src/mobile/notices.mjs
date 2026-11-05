// Durable delivery adapter: event ID, not private text, is the dedupe key.
// T3 native notification delivery is separate and must be tested on the phone.
export function noticeDelivery({ store, publish }) {
    return async function deliver() {
        let delivered = 0;
        for (const notice of await store.pendingNotices(100)) {
            const claim = await store.claimNotice(notice.id);
            if (!claim)
                continue;
            try {
                const receipt = await publish({ eventId: notice.id, kind: notice.kind, sessionId: notice.sessionId, title: 'Dock update ready', body: 'Open Dock to view the update.' });
                if (!receipt?.accepted || receipt.eventId !== notice.id)
                    throw Error('Delivery not acknowledged');
                await store.ackNotice(notice.id, receipt);
                delivered++;
            }
            catch {
                await store.releaseNotice(notice.id);
            }
        }
        return { delivered };
    };
}
