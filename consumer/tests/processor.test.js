const { processActivity } = require('../src/services/activityProcessor');
const Activity = require('../src/models/Activity');

jest.mock('../src/models/Activity');

describe('Activity Processor', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should successfully parse and save a valid message', async () => {
        const mockSave = jest.fn().mockResolvedValue(true);
        Activity.mockImplementation(() => ({
            save: mockSave
        }));

        const messageData = JSON.stringify({
            userId: "123e4567-e89b-12d3-a456-426614174000",
            eventType: "user_login",
            timestamp: "2023-10-27T10:00:00.000Z",
            payload: { browser: "Chrome" }
        });

        await processActivity(messageData);

        expect(Activity).toHaveBeenCalledTimes(1);
        expect(mockSave).toHaveBeenCalledTimes(1);
    });

    it('should throw a SyntaxError for invalid JSON', async () => {
        const messageData = "this is not valid json";

        await expect(processActivity(messageData)).rejects.toThrow(SyntaxError);
        expect(Activity).not.toHaveBeenCalled();
    });
});