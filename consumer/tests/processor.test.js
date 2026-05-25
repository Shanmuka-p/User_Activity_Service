const { processActivity } = require('../src/services/activityProcessor');
const Activity = require('../src/models/Activity');

jest.mock('../src/models/Activity');

// Base valid message data for reuse
const validMessageData = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    userId: "123e4567-e89b-12d3-a456-426614174000",
    eventType: "user_login",
    timestamp: "2023-10-27T10:00:00.000Z",
    payload: { browser: "Chrome" }
};

describe('Activity Processor', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should successfully parse JSON and call save', async () => {
        const mockSave = jest.fn().mockResolvedValue(true);
        Activity.mockImplementation(() => ({ save: mockSave }));

        await processActivity(JSON.stringify(validMessageData));

        expect(Activity).toHaveBeenCalledTimes(1);
        expect(mockSave).toHaveBeenCalledTimes(1);
    });

    it('should instantiate Activity with all required fields from the message', async () => {
        const mockSave = jest.fn().mockResolvedValue(true);
        Activity.mockImplementation(() => ({ save: mockSave }));

        await processActivity(JSON.stringify(validMessageData));

        expect(Activity).toHaveBeenCalledWith(expect.objectContaining({
            id: validMessageData.id,
            userId: validMessageData.userId,
            eventType: validMessageData.eventType,
            payload: validMessageData.payload
        }));
    });

    it('should throw a SyntaxError for invalid JSON without creating Activity', async () => {
        await expect(processActivity("this is not valid json")).rejects.toThrow(SyntaxError);
        expect(Activity).not.toHaveBeenCalled();
    });

    it('should propagate database errors so the worker can nack the message', async () => {
        const dbError = new Error('MongoDB write failed');
        const mockSave = jest.fn().mockRejectedValue(dbError);
        Activity.mockImplementation(() => ({ save: mockSave }));

        await expect(
            processActivity(JSON.stringify(validMessageData))
        ).rejects.toThrow('MongoDB write failed');
    });

    it('should handle different eventTypes correctly', async () => {
        const mockSave = jest.fn().mockResolvedValue(true);
        Activity.mockImplementation(() => ({ save: mockSave }));

        const purchaseEvent = { ...validMessageData, eventType: 'purchase', payload: { amount: 99.99 } };
        await processActivity(JSON.stringify(purchaseEvent));

        expect(Activity).toHaveBeenCalledWith(expect.objectContaining({
            eventType: 'purchase'
        }));
    });
});